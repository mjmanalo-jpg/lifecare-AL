"use client";

import { useState, useEffect, Suspense, Fragment } from "react";
import Swal from "sweetalert2";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  ShieldCheck,
  Activity,
  Users,
  Mic,
  User,
  CheckCircle,
  AlertTriangle,
  Settings,
  Plus,
  LogOut,
  Clock,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Play,
  Menu,
  X,
  Bell,
  Sun,
  Moon,
  Heart,
  Grid,
  FileText,
  Database,
  Cpu,
  Send,
  MessageSquare,
  Search,
  Check,
  Info,
  ChevronDown,
  Download,
  Home,
  Volume2
} from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import CameraVisionFeed from "@/components/CameraVisionFeed";
import { EmergencyCallSystem, IncidentQuickReport, QuickMessaging, VitalsQuickLog, TimeTracking } from "@/components/CaregiverModules";

type Role = "SUPERADMIN" | "NURSE" | "CAREGIVER" | "FAMILY";

interface RoleDetails {
  name: string;
  badge: string;
  desc: string;
  icon: any;
  profileName: string;
  footerText: string;
  basePath: string;
  sidebarLinks: { name: string; icon: any; route: string }[];
}

// Maps URL path segments to tab names
const ROUTE_TO_TAB: Record<string, string> = {
  dashboard: "Clinical Dashboard",
  monitoring: "Vitals Monitor",
  incidents: "Incident Log",
  records: "Resident Records",
  staff: "Staff Registry",
  telemetry: "System Telemetry",
  platform: "Platform Settings",
  tasks: "Task Checklist",
  residents: "Resident Status",
  reports: "Shift Reports",
  relative: "My Relative",
  timeline: "Health Timeline",
  // dashboard is also the default for all role-level roots
  admin: "Admin Dashboard",
  shift: "Shift Dashboard",
  family: "Family Dashboard",
};

// Maps URL role segments to Role keys
const PATH_TO_ROLE: Record<string, Role> = {
  nurse: "NURSE",
  superadmin: "SUPERADMIN",
  caregiver: "CAREGIVER",
  family: "FAMILY",
};

const ROLES: Record<Role, RoleDetails> = {
  SUPERADMIN: {
    name: "Super Admin",
    badge: "Operations",
    desc: "Oversee entire facility operations, manage staff registries, and monitor system health telemetry.",
    icon: Settings,
    profileName: "System Admin",
    basePath: "/superadmin",
    footerText: "Golden Hearth Operations Portal • System Node: 104-Admin • SSL Secure Connection",
    sidebarLinks: [
      { name: "Admin Dashboard",   icon: Grid,     route: "/superadmin/dashboard" },
      { name: "Staff Registry",    icon: Users,    route: "/superadmin/staff" },
      { name: "System Telemetry", icon: Activity, route: "/superadmin/telemetry" },
      { name: "Platform Settings", icon: Settings, route: "/superadmin/platform" },
    ],
  },
  NURSE: {
    name: "Head Nurse",
    badge: "Clinical Care",
    desc: "Access real-time resident vitals, receive instant fall detection warnings, and log logs via Voice AI.",
    icon: Activity,
    profileName: "Sarah Jenkins, RN",
    basePath: "/nurse",
    footerText: "Golden Hearth Resident Care Portal • Station: Nurse-3 • Resident Data Encryption Active",
    sidebarLinks: [
      { name: "Clinical Dashboard", icon: Grid,          route: "/nurse/dashboard" },
      { name: "Vitals Monitor",     icon: Activity,      route: "/nurse/monitoring" },
      { name: "Incident Log",       icon: AlertTriangle, route: "/nurse/incidents" },
      { name: "Resident Records",   icon: ShieldCheck,   route: "/nurse/records" },
    ],
  },
  CAREGIVER: {
    name: "On-Duty Caregiver",
    badge: "Daily Assistance",
    desc: "View resident assist checklists, check off task logs, and alert clinical staff of incident reports.",
    icon: Users,
    profileName: "Caleb Randall",
    basePath: "/caregiver",
    footerText: "Golden Hearth Assistance Portal • Caregiver ID: CR-8854 • Shift Status: Active",
    sidebarLinks: [
      { name: "Shift Dashboard",  icon: Grid,        route: "/caregiver/dashboard" },
      { name: "Task Checklist",   icon: CheckCircle, route: "/caregiver/tasks" },
      { name: "Resident Status",  icon: Users,       route: "/caregiver/residents" },
      { name: "Shift Reports",    icon: Clock,       route: "/caregiver/reports" },
    ],
  },
  FAMILY: {
    name: "Family Sponsor",
    badge: "Family Portal",
    desc: "Monitor your relative's vitals timeline and check daily comfort summaries.",
    icon: ShieldCheck,
    profileName: "John Pendelton",
    basePath: "/family",
    footerText: "Golden Hearth Family Space • Relative: Arthur Pendelton • Fully Secure & Private",
    sidebarLinks: [
      { name: "Family Dashboard", icon: Grid,       route: "/family/dashboard" },
      { name: "My Relative",      icon: User,       route: "/family/relative" },
      { name: "Health Timeline",  icon: Activity,   route: "/family/timeline" },
    ],
  },
};

function DashboardContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Derive role + tab from URL path (e.g. /nurse/monitoring → NURSE + "Vitals Monitor")
  const pathSegments = pathname.split("/").filter(Boolean); // e.g. ["nurse", "monitoring"]
  const roleSegment = pathSegments[0] ?? "";
  const tabSegment  = pathSegments[1] ?? "dashboard";

  // Fall back to query-param ?role= for the legacy /dashboard route
  const searchRole = searchParams.get("role") as Role | null;
  const activeRole: Role = PATH_TO_ROLE[roleSegment] ?? (searchRole && ROLES[searchRole] ? searchRole : "NURSE");
  const roleDetails = ROLES[activeRole];

  // Derive activeTab from the URL segment, fall back to first sidebar link
  // Special case: family dashboard
  const activeTab = (activeRole === "FAMILY" && tabSegment === "dashboard")
    ? "Family Dashboard"
    : ROUTE_TO_TAB[tabSegment] ?? roleDetails.sidebarLinks[0].name;

  // UI States
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [showLogoutAlert, setShowLogoutAlert] = useState(false);
  const [currentTime, setCurrentTime] = useState("");
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showVitalsModal, setShowVitalsModal] = useState(false);


  // Shared Data States
  const [vitalsLogs, setVitalsLogs] = useState([
    { id: 1, name: "Arthur Pendelton", room: "12A", type: "Heart Rate", value: "72 bpm", time: "Just now", status: "Normal" },
    { id: 2, name: "Eleanor Vance", room: "08B", type: "Blood Pressure", value: "118/75 mmHg", time: "10 mins ago", status: "Normal" },
    { id: 3, name: "Arthur Pendelton", room: "12A", type: "Oxygen Level", value: "98%", time: "1 hr ago", status: "Normal" },
  ]);
  
  const [incidents, setIncidents] = useState([
    { id: 1, room: "08B", resident: "Eleanor Vance", type: "Vitals Spurt", severity: "Warning", time: "2 hrs ago", status: "Resolved" },
    { id: 2, room: "03A", resident: "Gerald Cooper", type: "Posture Assist", severity: "Info", time: "4 hrs ago", status: "Resolved" },
  ]);

  const [staffList, setStaffList] = useState([
    { id: 1, name: "Sarah Jenkins, RN", role: "Head Nurse", email: "s.jenkins@goldenhearth.org", rooms: "01A - 15C" },
    { id: 2, name: "Caleb Randall", role: "Caregiver Specialist", email: "c.randall@goldenhearth.org", rooms: "01A - 08B" },
    { id: 3, name: "Elena Rostova", role: "Nursing Assistant", email: "e.rostova@goldenhearth.org", rooms: "09C - 15A" },
  ]);

  const [tasks, setTasks] = useState([
    { id: 1, room: "04B", task: "Deliver morning insulin dose", done: false },
    { id: 2, room: "12A", task: "Assist with garden stroll", done: true },
    { id: 3, room: "09C", task: "Verify oxygen cylinder pressure", done: false },
    { id: 4, room: "15A", task: "Record physical therapy attendance", done: true },
  ]);

  // Voice Chat State
  const [voiceText, setVoiceText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [nlpJson, setNlpJson] = useState<any>(null);
  const [showVoicePopup, setShowVoicePopup] = useState(false);
  const [recognitionRef, setRecognitionRef] = useState<any>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceChatHistory, setVoiceChatHistory] = useState<Array<{role: "user" | "ai", text: string, timestamp: string}>>([]);
  const [aiResponse, setAiResponse] = useState("");
  const [voiceTypedInput, setVoiceTypedInput] = useState("");

  // Fall Alarm State
  const [fallAlert, setFallAlert] = useState(false);
  const [isFallen, setIsFallen] = useState(false);

  // Form Inputs
  const [newStaff, setNewStaff] = useState({ name: "", role: "Head Nurse", email: "", rooms: "" });
  const [newReport, setNewReport] = useState("");
  const [caregiverNotes, setCaregiverNotes] = useState<string[]>([]);
  
  // Settings Toggles
  const [settings, setSettings] = useState({
    opticalMatrix: true,
    voiceNLP: true,
    hipaaLock: true,
    testMode: false
  });

  // Support Portal Chat States (Family Floating Modal)
  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState([
    { sender: "ai", text: "Hello! I am your Golden Hearth Care Assistant. How can I help you today regarding Arthur's comfort or status?" }
  ]);
  const [showFamilyChatModal, setShowFamilyChatModal] = useState(false);
  const [familyVoiceText, setFamilyVoiceText] = useState("");
  const [familyIsRecording, setFamilyIsRecording] = useState(false);
  const [familyIsSpeaking, setFamilyIsSpeaking] = useState(false);
  const [familyRecognitionRef, setFamilyRecognitionRef] = useState<any>(null);
  const [familyAiResponse, setFamilyAiResponse] = useState("");

  // =============== CAREGIVER PORTAL STATES ===============

  // 1. Emergency Call System
  const [callBells, setCallBells] = useState([
    { id: 1, room: "04B", resident: "Arthur Pendelton", time: "Just now", status: "active", priority: "normal" },
    { id: 2, room: "08B", resident: "Eleanor Vance", time: "5 mins ago", status: "acknowledged", priority: "high" }
  ]);
  const [callHistory, setCallHistory] = useState<Array<{id: number, room: string, resident: string, time: string, duration: string, resolved: boolean}>>([]);

  // 2. Incident Quick-Report
  const [caregiverIncidents, setCaregiverIncidents] = useState([
    { id: 1, type: "Fall", severity: "critical", room: "12A", resident: "Arthur", time: "14:30", notes: "Slipped on wet floor", reported: true },
    { id: 2, type: "Medication Error", severity: "high", room: "08B", resident: "Eleanor", time: "10:15", notes: "Took wrong dosage", reported: true }
  ]);
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [newIncident, setNewIncident] = useState({ type: "Fall", severity: "normal", room: "", resident: "", notes: "" });

  // 3. Medication Verification
  const [medicationLog, setMedicationLog] = useState([
    { id: 1, resident: "Arthur", medication: "Insulin", time: "08:00", verified: true, signature: "Caleb R." },
    { id: 2, resident: "Eleanor", medication: "Blood Pressure Med", time: "18:00", verified: false, signature: "" }
  ]);

  // 4. Smart Task Management
  const [taskFilter, setTaskFilter] = useState<"all" | "pending" | "completed">("all");
  const [taskSortBy, setTaskSortBy] = useState<"room" | "time" | "priority">("room");

  // 5. Resident Communication Board
  const [residentNotes, setResidentNotes] = useState<Array<{id: number, residentId: number, resident: string, note: string, timestamp: string, caregiver: string, read: boolean}>>([
    { id: 1, residentId: 1, resident: "Arthur Pendelton", note: "Prefers tea over coffee. Sensitive to noise during nap time.", timestamp: "Today 10:30", caregiver: "Elena R.", read: true },
    { id: 2, residentId: 2, resident: "Eleanor Vance", note: "Mood was low this morning. Encouraged gentle activity.", timestamp: "Today 08:15", caregiver: "Caleb R.", read: false }
  ]);
  const [newNote, setNewNote] = useState("");
  const [selectedResidentForNote, setSelectedResidentForNote] = useState<number | null>(null);

  // 6. In-App Messaging
  const [messages, setMessages] = useState<Array<{id: number, from: string, to: string, text: string, timestamp: string, status: "pending" | "acknowledged" | "resolved"}>>([
    { id: 1, from: "Caleb R.", to: "Sarah Jenkins (Nurse)", text: "Need assistance with Arthur in room 12A", timestamp: "14:45", status: "acknowledged" },
    { id: 2, from: "Elena R.", to: "Supervisor", text: "Eleanor reporting discomfort", timestamp: "15:20", status: "pending" }
  ]);
  const [newMessage, setNewMessage] = useState("");
  const [messageRecipient, setMessageRecipient] = useState("Sarah Jenkins (Nurse)");
  const [showMessaging, setShowMessaging] = useState(false);

  // 7. Daily Shift Summary
  const [shiftSummary, setShiftSummary] = useState({
    date: "Today",
    tasksCompleted: 3,
    tasksTotal: 4,
    incidentsReported: 2,
    callBellsResponded: 8,
    avgResponseTime: "2.5 mins",
    residentEngagement: 85
  });

  // 8. Resident Interaction Log
  const [interactionLog, setInteractionLog] = useState<Array<{id: number, resident: string, activity: string, time: string}>>([
    { id: 1, resident: "Arthur Pendelton", activity: "Meal", time: "12:30" },
    { id: 2, resident: "Eleanor Vance", activity: "Activity", time: "14:00" },
    { id: 3, resident: "Arthur Pendelton", activity: "Assist", time: "14:45" }
  ]);

  // 9. Performance Dashboard
  const [performanceMetrics, setPerformanceMetrics] = useState({
    taskCompletion: 95,
    callResponseTime: 2.8,
    qualityScore: 92,
    safetyIncidents: 1,
    monthlyTrend: [85, 88, 90, 92, 95]
  });

  // 10. Vitals Quick-Check
  const [vitalsLog, setVitalsLog] = useState<Array<{id: number, resident: string, bp: string, temp: string, o2: string, time: string}>>([
    { id: 1, resident: "Arthur", bp: "120/80", temp: "98.6°F", o2: "98%", time: "08:00" },
    { id: 2, resident: "Eleanor", bp: "118/75", temp: "98.2°F", o2: "97%", time: "08:15" }
  ]);
  const [showVitalsForm, setShowVitalsForm] = useState(false);
  const [newVitals, setNewVitals] = useState({ resident: "", bp: "", temp: "", o2: "" });

  // 11. Handoff Briefing
  const [handoffBriefing, setHandoffBriefing] = useState({
    shiftStart: "08:00 AM",
    shiftEnd: "04:00 PM",
    keyAlerts: [
      "Arthur - Monitor for fall risk, slipped yesterday",
      "Eleanor - Mood monitoring, low this morning",
      "Gerald - New medication, watch for side effects"
    ],
    outstandingTasks: ["Oxygen check for room 09C", "Physical therapy follow-up for Arthur"],
    specialNotes: "Two residents have visitors arriving at 2 PM"
  });

  // 12. Time Tracking
  const [shiftTime, setShiftTime] = useState({
    clockIn: "08:00 AM",
    clockOut: null as string | null,
    breakStart: null as string | null,
    breakEnd: null as string | null,
    totalHours: 0,
    breakHours: 0,
    status: "clocked-in" as "clocked-in" | "on-break" | "clocked-out"
  });

  // Incident Log Tab States
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIncidents, setSelectedIncidents] = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  // Resident Records Tab States
  const [researchTerm, setResearchTerm] = useState("");
  const [selectedRecords, setSelectedRecords] = useState<Set<number>>(new Set());
  const [resCurrentPage, setResCurrentPage] = useState(1);
  const [resEditingId, setResEditingId] = useState<number | null>(null);
  const [resExportOpen, setResExportOpen] = useState(false);
  const [showResSearchModal, setShowResSearchModal] = useState(false);
  const [residentRecords, setResidentRecords] = useState([
    { id: 1, name: "Arthur Pendelton", room: "12A", care: "Assisted Living", sponsor: "John Pendelton", medications: "Morning Insulin (08:00), Vitamin D (12:00)", status: "Active" },
    { id: 2, name: "Eleanor Vance", room: "08B", care: "Skilled Nursing", sponsor: "Lillian Vance", medications: "Blood Pressure (18:00)", status: "Active" },
    { id: 3, name: "Gerald Cooper", room: "03A", care: "Independent Care", sponsor: "Margot Cooper", medications: "N/A", status: "Active" },
    { id: 4, name: "Harriet Finch", room: "11C", care: "Memory Care", sponsor: "Robert Finch", medications: "Aricept (08:00, 20:00)", status: "Active" },
    { id: 5, name: "Margaret Stone", room: "14B", care: "Assisted Living", sponsor: "David Stone", medications: "Lipitor (18:00)", status: "Active" },
  ]);

  // Edit Modal State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editModalData, setEditModalData] = useState<any>(null);
  const [editModalType, setEditModalType] = useState<"incident" | "resident" | null>(null);

  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem("theme") as "dark" | "light" | null;
    setTheme(savedTheme || "dark");

    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
      }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // (activeTab is now derived from URL — no useEffect needed)

  // Initialize Speech Recognition & TTS voices
  useEffect(() => {
    if (typeof window === "undefined" || activeRole !== "NURSE") return;

    // Load available voices for TTS
    if ("speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          console.log(`🎤 ${voices.length} voices available`);
        }
      };
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech Recognition not supported");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsRecording(true);
      setVoiceText("Listening...");
    };

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          setVoiceText(transcript);
          generateAndSpeakAIResponse(transcript);
        } else {
          interim += transcript;
        }
      }
      if (interim) setVoiceText(interim);
    };

    recognition.onerror = (event: any) => {
      // Hide "no-speech" errors (normal when user hasn't spoken)
      if (event.error === "no-speech") {
        console.log("No speech detected (normal)");
        return;
      }
      // Show only critical errors
      const criticalErrors = ["network-error", "service-unavailable", "not-allowed"];
      if (criticalErrors.includes(event.error)) {
        console.error("Speech recognition error:", event.error);
        setVoiceText(`Error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsRecording(false);
      // When user stops speaking, AI should respond
      if (voiceText && voiceText !== "Listening...") {
        generateAndSpeakAIResponse(voiceText);
      }
    };

    setRecognitionRef(recognition);
    return () => recognition.abort();
  }, [activeRole]);

  // Initialize Family Portal Voice Recognition
  useEffect(() => {
    if (typeof window === "undefined" || activeRole !== "FAMILY") return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setFamilyIsRecording(true);
      setFamilyVoiceText("Listening...");
    };

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          setFamilyVoiceText(transcript);
          familyGenerateAndSpeakAIResponse(transcript);
        } else {
          interim += transcript;
        }
      }
      if (interim) setFamilyVoiceText(interim);
    };

    recognition.onerror = (event: any) => {
      if (event.error === "no-speech") {
        console.log("No speech detected (normal)");
        return;
      }
      const criticalErrors = ["network-error", "service-unavailable", "not-allowed"];
      if (criticalErrors.includes(event.error)) {
        setFamilyVoiceText(`Error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setFamilyIsRecording(false);
      if (familyVoiceText && familyVoiceText !== "Listening...") {
        familyGenerateAndSpeakAIResponse(familyVoiceText);
      }
    };

    setFamilyRecognitionRef(recognition);
    return () => recognition.abort();
  }, [activeRole]);

  const familyGenerateAndSpeakAIResponse = async (userMessage: string) => {
    setChatHistory(prev => [...prev, { sender: "user", text: userMessage }]);
    setFamilyIsSpeaking(true);
    setFamilyAiResponse("...");

    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chat", message: userMessage }),
      });

      const data = await res.json();
      const response: string = data.text ?? "I'm having trouble understanding. Please try again.";

      setFamilyAiResponse(response);
      setChatHistory(prev => [...prev, { sender: "ai", text: response }]);
      await familySpeakAIResponse(response);
    } catch (err) {
      console.error("Family chat error:", err);
      const fallback = "I'm having trouble connecting. Please try again.";
      setFamilyAiResponse(fallback);
      setChatHistory(prev => [...prev, { sender: "ai", text: fallback }]);
      await familySpeakAIResponse(fallback);
    }
  };

  const familySpeakAIResponse = async (text: string): Promise<void> => {
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "tts",
          text,
          voiceSettings: {
            pitch: 1.2,
            speakingRate: 0.9,
            voiceGender: "FEMALE"
          }
        }),
      });

      const data = await res.json();

      if (!data.fallback && data.audio) {
        const binary = atob(data.audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: data.mimeType ?? "audio/wav" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => {
          setFamilyIsSpeaking(false);
          setFamilyVoiceText("");
          setFamilyAiResponse("");
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => { setFamilyIsSpeaking(false); URL.revokeObjectURL(url); };
        await audio.play();
        return;
      }
    } catch (err) {
      console.warn("Family TTS failed, falling back to browser TTS:", err);
    }

    if (!("speechSynthesis" in window)) { setFamilyIsSpeaking(false); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);

    utterance.rate = 0.9;
    utterance.pitch = 1.2;
    utterance.volume = 1;

    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(v => v.name.includes("Female") || v.name.includes("female") || v.name.includes("Woman")) ||
                        voices.find(v => !v.name.includes("Male") && !v.name.includes("male")) ||
                        voices[0];
    if (femaleVoice) utterance.voice = femaleVoice;

    utterance.onend = () => { setFamilyIsSpeaking(false); setFamilyVoiceText(""); setFamilyAiResponse(""); };
    utterance.onerror = () => { setFamilyIsSpeaking(false); };
    window.speechSynthesis.speak(utterance);
  };

  const toggleFamilyVoiceRecording = () => {
    if (!familyRecognitionRef) return;

    if (familyIsRecording) {
      familyRecognitionRef.stop();
    } else {
      setFamilyVoiceText("");
      setFamilyAiResponse("");
      familyRecognitionRef.start();
    }
  };


  const generateAndSpeakAIResponse = async (userMessage: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setVoiceChatHistory(prev => [...prev, { role: "user", text: userMessage, timestamp }]);
    setIsSpeaking(true);
    setAiResponse("...");

    try {
      // Call Gemini via server-side API route (keeps API key safe)
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chat", message: userMessage }),
      });

      const data = await res.json();
      const response: string = data.text ?? "Understood.";

      setAiResponse(response);
      setVoiceChatHistory(prev => [...prev, { role: "ai", text: response, timestamp }]);
      await speakAIResponse(response);
    } catch (err) {
      console.error("Gemini chat error:", err);
      const fallback = "I'm having trouble connecting. Please try again.";
      setAiResponse(fallback);
      setVoiceChatHistory(prev => [...prev, { role: "ai", text: fallback, timestamp }]);
      await speakAIResponse(fallback);
    }
  };

  const addMessageToHistory = (role: "user" | "ai", text: string, timestamp: string) => {
    setVoiceChatHistory(prev => [...prev, { role, text, timestamp }]);
  };

  const speakAIResponse = async (text: string): Promise<void> => {
    try {
      // Try Gemini TTS first with natural voice settings
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

      if (!data.fallback && data.audio) {
        // Decode base64 audio and play it
        const binary = atob(data.audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: data.mimeType ?? "audio/wav" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => {
          setIsSpeaking(false);
          setVoiceText("");
          setAiResponse("");
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => { setIsSpeaking(false); URL.revokeObjectURL(url); };
        await audio.play();
        return;
      }
    } catch (err) {
      console.warn("Gemini TTS failed, falling back to browser TTS:", err);
    }

    // Fallback: browser Web Speech API with natural, friendly settings
    if (!("speechSynthesis" in window)) { setIsSpeaking(false); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);

    // Natural, conversational voice settings
    utterance.rate = 0.9;  // Slightly slower for clarity and warmth
    utterance.pitch = 1.2; // Slightly higher pitch for friendliness
    utterance.volume = 1;

    // Select a female voice if available (typically sounds friendlier)
    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(v => v.name.includes("Female") || v.name.includes("female") || v.name.includes("Woman")) ||
                        voices.find(v => !v.name.includes("Male") && !v.name.includes("male")) ||
                        voices[0];
    if (femaleVoice) utterance.voice = femaleVoice;

    utterance.onend = () => { setIsSpeaking(false); setVoiceText(""); setAiResponse(""); };
    utterance.onerror = () => { setIsSpeaking(false); };
    window.speechSynthesis.speak(utterance);
  };

  const toggleVoiceRecording = () => {
    if (!recognitionRef) return;

    if (isRecording) {
      recognitionRef.stop();
    } else {
      setVoiceText("");
      setAiResponse("");
      setNlpJson(null);
      recognitionRef.start();
    }
  };

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    if (nextTheme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
  };

  const handleLogout = () => {
    setIsFallen(false);
    setFallAlert(false);
    router.push("/login");
  };

  const triggerLogoutAlert = () => setShowLogoutAlert(true);
  const confirmLogout = () => { setShowLogoutAlert(false); handleLogout(); };
  const cancelLogout = () => setShowLogoutAlert(false);

  const toggleTask = (id: number) => {
    setTasks(tasks.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };


  const triggerFallAlert = () => {
    setIsFallen(true);
    setFallAlert(true);
    setVitalsLogs(prev => [
      { id: Date.now(), name: "Arthur Pendelton", room: "12A", type: "ACCIDENT WARNING", value: "Fall Event Detected", time: "Just now", status: "Critical" },
      ...prev
    ]);
    setIncidents(prev => [
      { id: Date.now(), room: "12A", resident: "Arthur Pendelton", type: "Fall Incident", severity: "Critical", time: "Just now", status: "Dispatched" },
      ...prev
    ]);
  };

  const handleRegisterStaff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaff.name || !newStaff.email) return;
    setStaffList(prev => [
      ...prev,
      { id: Date.now(), name: newStaff.name, role: newStaff.role, email: newStaff.email, rooms: newStaff.rooms || "N/A" }
    ]);
    setNewStaff({ name: "", role: "Head Nurse", email: "", rooms: "" });
  };

  const handleAddShiftReport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReport) return;
    setCaregiverNotes(prev => [newReport, ...prev]);
    setNewReport("");
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    const userMsg = chatMessage;
    setChatHistory(prev => [...prev, { sender: "user", text: userMsg }]);
    setChatMessage("");

    setTimeout(() => {
      let aiResponse = "I've checked the clinical dashboard. Everything is currently stable.";
      if (userMsg.toLowerCase().includes("vitals") || userMsg.toLowerCase().includes("heart")) {
        aiResponse = "Arthur's latest vitals show a heart rate of 72 bpm which is well within his normal rest range. He is comfortable.";
      } else if (userMsg.toLowerCase().includes("fall") || userMsg.toLowerCase().includes("safe")) {
        aiResponse = "The Suite 12A Optical Matrix sensor reports no safety alerts. Arthur has been moving around safely today.";
      } else if (userMsg.toLowerCase().includes("activity") || userMsg.toLowerCase().includes("today")) {
        aiResponse = "According to caregiver logs, Arthur completed his garden stroll this morning and participated in physical therapy.";
      }
      setChatHistory(prev => [...prev, { sender: "ai", text: aiResponse }]);
    }, 1000);
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full text-left">
      {/* Brand Header */}
      <div className={`flex items-center pb-6 border-b border-border/50 ${isSidebarCollapsed ? "justify-center" : "justify-between"}`}>
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-tr from-yellow-500/20 to-amber-400/20 border border-amber-500/30 shrink-0">
            <svg className="w-5 h-5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" className="fill-amber-500/10" />
              <path d="M12 5V9M12 15V19M5 12H9M15 12H19" strokeLinecap="round" />
              <circle cx="12" cy="5" r="1.2" className="fill-amber-400" />
              <circle cx="12" cy="19" r="1.2" className="fill-amber-400" />
              <circle cx="5" cy="12" r="1.2" className="fill-amber-400" />
              <circle cx="19" cy="12" r="1.2" className="fill-amber-400" />
              <path d="M4 16C4 16 8 20 12 20C16 20 20 16 20 16M4 8C4 8 8 4 12 4C16 4 20 8 20 8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          {!isSidebarCollapsed && (
            <div>
              <h1 className="text-sm font-bold tracking-tight text-foreground leading-none">Golden Hearth</h1>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold mt-0.5">Portal Console</p>
            </div>
          )}
        </div>
        
        <button
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="hidden lg:flex p-1.5 rounded-lg hover:bg-foreground/5 text-muted-foreground hover:text-foreground cursor-pointer border border-border/10 ml-2"
          title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isSidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Section */}
      <div className="flex-1 py-8 flex flex-col gap-1">
        {roleDetails.sidebarLinks.map(link => {
          const IconComponent = link.icon;
          const isActive = activeTab === link.name;
          return (
            <button
              key={link.name}
              onClick={() => {
                router.push(link.route);
                setIsMobileSidebarOpen(false);
              }}
              title={isSidebarCollapsed ? link.name : undefined}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center transition-all cursor-pointer ${isSidebarCollapsed ? "justify-center gap-0" : "gap-3"} ${isActive ? "bg-amber-500/15 text-amber-500 border border-amber-500/10" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"}`}
            >
              <IconComponent className="w-4.5 h-4.5 shrink-0" />
              {!isSidebarCollapsed && <span>{link.name}</span>}
            </button>
          );
        })}
      </div>

      {/* Bottom Footer Details */}
      <div className="pt-6 border-t border-border/50">
        <div className={`flex items-center gap-3 ${isSidebarCollapsed ? "justify-center" : ""}`}>
          <span className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center font-bold text-amber-500 text-xs border border-amber-500/20 shadow-sm shrink-0">
            {roleDetails.profileName.split(" ").map(n => n[0]).join("")}
          </span>
          {!isSidebarCollapsed && (
            <div>
              <p className="text-xs font-bold leading-none text-foreground">{roleDetails.profileName}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{roleDetails.name}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
  const renderUnifiedDashboard = () => {
    const doneTasks = tasks.filter(t => t.done).length;
    const totalTasks = tasks.length;
    const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    // Define Role Specific Configurations
    let cards: any[] = [];
    let charts: any = {
      chart1: { title: "", desc: "", labels: [], pts: [], svgPath: "", linePath: "", color: "", gradId: "" },
      chart2: { title: "", desc: "", items: [] },
      chart3: { title: "", desc: "", days: [] },
      chart4: { title: "", desc: "", pct: 0, valText: "", labelText: "", subLabelText: "", hoverValText: "", hoverSubLabelText: "" },
      chart5: { title: "", desc: "", color: "text-green-500", labels: [], pts: [], linePath: "" }
    };

    if (activeRole === "SUPERADMIN") {
      cards = [
        { label: "API Sync Node", value: "ONLINE", desc: "SSL secure gateway", icon: Settings, color: "text-green-500 bg-green-500/10 border-green-500/20" },
        { label: "Registered Staff", value: `${staffList.length} Active`, desc: "Facility registry profiles", icon: Users, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
        { label: "Total Residents", value: "14 Residents", desc: "Sponsored suites", icon: Users, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
        { label: "Optical Edge Nodes", value: "4 Live Cameras", desc: "Edge computer vision", icon: ShieldCheck, color: "text-green-500 bg-green-500/10 border-green-500/20" },
        { label: "Edge Latency", value: "12ms avg", desc: "Frame processing speed", icon: Activity, color: "text-zinc-500 bg-zinc-500/10 border-zinc-500/20" },
        { label: "Webhooks Logged", value: "1,240 Syncs", desc: "Stripe & care db webhooks", icon: Database, color: "text-zinc-500 bg-zinc-500/10 border-zinc-500/20" },
        { label: "System Health", value: "99.9% Up", desc: "Active server nodes", icon: Settings, color: "text-green-500 bg-green-500/10 border-green-500/20" }
      ];

      charts = {
        chart1: {
          title: "GPU Frame Latency Trend",
          desc: "Real-time edge processing frame dispatch latency.",
          labels: ["11:00", "11:10", "11:20", "11:30", "11:40"],
          pts: [
            { left: "0%", top: "60.0%", label: "11:00", val: "12ms" },
            { left: "25%", top: "50.0%", label: "11:10", val: "15ms" },
            { left: "50%", top: "63.3%", label: "11:20", val: "11ms" },
            { left: "75%", top: "20.0%", label: "11:30", val: "32ms" },
            { left: "100%", top: "70.0%", label: "11:40", val: "9ms" }
          ],
          svgPath: "M0,18 L25,15 L50,19 L75,6 L100,21 L100,30 L0,30 Z",
          linePath: "M0,18 L25,15 L50,19 L75,6 L100,21",
          color: "text-amber-500",
          gradId: "adminGrad"
        },
        chart2: {
          title: "System API Allocation Load",
          desc: "Load distribution metrics across network interfaces.",
          items: [
            { label: "Wing A", val: 80, desc: "Edge vision server allocation" },
            { label: "Wing B", val: 95, desc: "Local database sync server" },
            { label: "NLP API", val: 70, desc: "Speech transcribing instance load" },
            { label: "Stripe", val: 85, desc: "Billing webhook sync thread load" },
            { label: "Webcam", val: 90, desc: "Live optical matrix dispatch queue" }
          ]
        },
        chart3: {
          title: "Edge Alerts Disconnected",
          desc: "Hourly occurrences of dropped edge frames.",
          days: [
            { day: "M", val: 0 },
            { day: "T", val: 1 },
            { day: "W", val: 0 },
            { day: "T", val: 2 },
            { day: "F", val: 0 },
            { day: "S", val: 0 },
            { day: "S", val: 0 }
          ]
        },
        chart4: {
          title: "System Node CPU Load",
          desc: "Real-time edge computation cluster loading.",
          pct: 24,
          valText: "24%",
          labelText: "24%",
          subLabelText: "CPU Load",
          hoverValText: "Node 10",
          hoverSubLabelText: "Cluster A"
        },
        chart5: {
          title: "Subscription Stripe Billing",
          desc: "Stripe payout value volumes processed monthly.",
          color: "text-green-500",
          labels: ["Mar", "Apr", "May", "Jun", "Jul"],
          pts: [
            { left: "0%", top: "93.3%", month: "Mar", val: "$2.8K" },
            { left: "25%", top: "60.0%", month: "Apr", val: "$3.0K" },
            { left: "50%", top: "73.3%", month: "May", val: "$2.9K" },
            { left: "75%", top: "26.7%", month: "Jun", val: "$3.2K" },
            { left: "100%", top: "16.7%", month: "Jul", val: "$3.3K" }
          ],
          linePath: "M0,28 L25,18 L50,22 L75,8 L100,5"
        }
      };
    } else if (activeRole === "NURSE") {
      cards = [
        { label: "Total Residents", value: "14 Profiles", desc: "Active medical charts", icon: Users, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
        { label: "Safety Status", value: fallAlert ? "FALL ALARM" : "ALL SECURE", desc: fallAlert ? "Emergency wing active" : "Optical Matrix normal", icon: ShieldCheck, color: fallAlert ? "text-red-500 bg-red-500/15 border-red-500/30 animate-pulse font-bold" : "text-green-500 bg-green-500/10 border-green-500/20" },
        { label: "Clinicians On Duty", value: "3 Active", desc: "Active nurse roster", icon: Activity, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
        { label: "Active Warnings", value: fallAlert ? "1 Urgent" : "0 Warnings", desc: fallAlert ? "POSTURE_ANOMALY" : "Normal vital threshold", icon: AlertTriangle, color: fallAlert ? "text-red-500 bg-red-500/15 border-red-500/30 animate-bounce" : "text-zinc-500 bg-zinc-500/10 border-zinc-500/20" },
        { label: "Avg Heart Rate", value: "74 bpm", desc: "Composite wing avg", icon: Activity, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
        { label: "Medication Compliance", value: "98% Met", desc: "Wing A + B schedules", icon: CheckCircle, color: "text-green-500 bg-green-500/10 border-green-500/20" },
        { label: "Voice logs synced", value: "18 logs", desc: "Clinical notes generated", icon: Mic, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" }
      ];

      charts = {
        chart1: {
          title: "Resident Vitals Trend",
          desc: "Real-time composite telemetry heart rate values.",
          labels: ["08:00", "12:00", "16:00", "20:00", "24:00"],
          pts: [
            { left: "0%", top: "83.3%", label: "08:00", val: "72 bpm" },
            { left: "25%", top: "66.7%", label: "12:00", val: "74 bpm" },
            { left: "50%", top: "73.3%", label: "16:00", val: "73 bpm" },
            { left: "75%", top: "40.0%", label: "20:00", val: "78 bpm" },
            { left: "100%", top: "33.3%", label: "24:00", val: "80 bpm" }
          ],
          svgPath: "M0,25 L25,20 L50,22 L75,12 L100,10 L100,30 L0,30 Z",
          linePath: "M0,25 L25,20 L50,22 L75,12 L100,10",
          color: "text-amber-500",
          gradId: "vitalsGrad"
        },
        chart2: {
          title: "Clinician Shift Rotation",
          desc: "Total nursing and care support hours logged weekly.",
          items: [
            { label: "Caleb R.", val: 80, desc: "80 hours shift coverage Wing A" },
            { label: "Lillian V.", val: 95, desc: "95 hours clinical supervision Wing B" },
            { label: "Margot C.", val: 70, desc: "70 hours auxiliary nursing care" },
            { label: "Robert F.", val: 85, desc: "85 hours on-call medical coverage" },
            { label: "Elena R.", val: 90, desc: "90 hours memory care specialized shift" }
          ]
        },
        chart3: {
          title: "Safety Alarms & Posture Anomalies",
          desc: "Weekly frequency of fall alarms or warnings.",
          days: [
            { day: "M", val: 1 },
            { day: "T", val: 0 },
            { day: "W", val: 2 },
            { day: "T", val: fallAlert ? 3 : 1 },
            { day: "F", val: 0 },
            { day: "S", val: 0 },
            { day: "S", val: 0 }
          ]
        },
        chart4: {
          title: "Daily Task Progression",
          desc: "Vitals checks schedule checklist completion ratio.",
          pct: pct,
          valText: `${pct}%`,
          labelText: `${doneTasks}/${totalTasks}`,
          subLabelText: "Ratio",
          hoverValText: `${pct}%`,
          hoverSubLabelText: "Done"
        },
        chart5: {
          title: "Care Log Speech Syncs",
          desc: "Transcribed audio voice notes registered in local DB.",
          color: "text-green-500",
          labels: ["Mar", "Apr", "May", "Jun", "Jul"],
          pts: [
            { left: "0%", top: "93.3%", month: "Mar", val: "12 logs" },
            { left: "25%", top: "60.0%", month: "Apr", val: "18 logs" },
            { left: "50%", top: "73.3%", month: "May", val: "14 logs" },
            { left: "75%", top: "26.7%", month: "Jun", val: "22 logs" },
            { left: "100%", top: "16.7%", month: "Jul", val: "30 logs" }
          ],
          linePath: "M0,28 L25,18 L50,22 L75,8 L100,5"
        }
      };
    } else if (activeRole === "CAREGIVER") {
      cards = [
        { label: "Current Shift", value: "Wing A - Morning", desc: "Scheduled: 08:00 - 16:00", icon: ShieldCheck, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
        { label: "Tasks Pending", value: `${totalTasks - doneTasks} Tasks`, desc: "Comfort checklist remaining", icon: CheckCircle, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
        { label: "Resident Safety", value: "ALL SECURE", desc: "Wing A rooms verified", icon: ShieldCheck, color: "text-green-500 bg-green-500/10 border-green-500/20" },
        { label: "Daily Care Logs", value: "8 Entered", desc: "Speech transcribes registered", icon: Mic, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
        { label: "Emergency Calls", value: "0 Calls", desc: "No call bells active", icon: AlertTriangle, color: "text-green-500 bg-green-500/10 border-green-500/20" },
        { label: "Completed Walks", value: "4 Walks", desc: "Assisted mobility logs", icon: Activity, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
        { label: "Shift Remaining", value: "4.5 Hours", desc: "Roster cycle status", icon: Settings, color: "text-zinc-500 bg-zinc-500/10 border-zinc-500/20" }
      ];

      charts = {
        chart1: {
          title: "Resident Mobility Duration",
          desc: "Total assisted mobility/walking times logged today.",
          labels: ["09:00", "11:00", "13:00", "15:00", "17:00"],
          pts: [
            { left: "0%", top: "70.0%", label: "09:00", val: "20m" },
            { left: "25%", top: "50.0%", label: "11:00", val: "30m" },
            { left: "50%", top: "33.3%", label: "13:00", val: "40m" },
            { left: "75%", top: "60.0%", label: "15:00", val: "25m" },
            { left: "100%", top: "26.7%", label: "17:00", val: "45m" }
          ],
          svgPath: "M0,21 L25,15 L50,10 L75,18 L100,8 L100,30 L0,30 Z",
          linePath: "M0,21 L25,15 L50,10 L75,18 L100,8",
          color: "text-amber-500",
          gradId: "caregiverGrad"
        },
        chart2: {
          title: "Caregiver Wing Coverage",
          desc: "Proportion of shift time spent in wing sections.",
          items: [
            { label: "Wing A", val: 85, desc: "Comfort checks & dining assist" },
            { label: "Wing B", val: 45, desc: "Backup medication supervision" },
            { label: "Day Lounge", val: 70, desc: "Social activities monitoring" },
            { label: "Dining Hall", val: 95, desc: "Meal preparation and assistance" },
            { label: "Garden Yard", val: 60, desc: "Assisted walking exercises" }
          ]
        },
        chart3: {
          title: "Hourly Logs Registered",
          desc: "Logs registered per shift hour.",
          days: [
            { day: "08h", val: 1 },
            { day: "10h", val: 2 },
            { day: "12h", val: 3 },
            { day: "14h", val: 1 },
            { day: "16h", val: 2 },
            { day: "18h", val: 0 },
            { day: "20h", val: 0 }
          ]
        },
        chart4: {
          title: "Shift Tasks Completed",
          desc: "Shift comfort checklist completion progression.",
          pct: pct,
          valText: `${pct}%`,
          labelText: `${doneTasks}/${totalTasks}`,
          subLabelText: "Ratio",
          hoverValText: `${pct}%`,
          hoverSubLabelText: "Done"
        },
        chart5: {
          title: "Active Duty Log Speed",
          desc: "Average time in minutes to file logs post-duty.",
          color: "text-green-500",
          labels: ["09:00", "11:00", "13:00", "15:00", "17:00"],
          pts: [
            { left: "0%", top: "83.3%", month: "09:00", val: "5m file time" },
            { left: "25%", top: "60.0%", month: "11:00", val: "12m file time" },
            { left: "50%", top: "73.3%", month: "13:00", val: "8m file time" },
            { left: "75%", top: "26.7%", month: "15:00", val: "22m file time" },
            { left: "100%", top: "16.7%", month: "17:00", val: "18m file time" }
          ],
          linePath: "M0,25 L25,18 L50,22 L75,8 L100,5"
        }
      };
    } else {
      // FAMILY
      cards = [
        { label: "Relative Name", value: "Arthur Pendelton", desc: "Room 12A • Wing A Suite", icon: Users, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
        { label: "Relative Safety", value: isFallen ? "FALL DETECTED!" : "ALL SECURE", desc: isFallen ? "Optical anomaly triggered" : "Edge camera verified", icon: ShieldCheck, color: isFallen ? "text-red-500 bg-red-500/15 border-red-500/30 animate-pulse font-bold" : "text-green-500 bg-green-500/10 border-green-500/20" },
        { label: "Relative Checklist", value: `${doneTasks}/${totalTasks} Met`, desc: "Comfort check completion status", icon: CheckCircle, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
        { label: "Vitals Stability", value: "STABLE", desc: "No cardiovascular warning", icon: Activity, color: "text-green-500 bg-green-500/10 border-green-500/20" },
        { label: "Suite Climate", value: "72°F Normal", desc: "Thermostat node active", icon: Settings, color: "text-green-500 bg-green-500/10 border-green-500/20" },
        { label: "Next Visit", value: "Saturday 2PM", desc: "Lounge room scheduled", icon: CheckCircle, color: "text-zinc-500 bg-zinc-500/10 border-zinc-500/20" },
        { label: "Billing Standing", value: "No Balance", desc: "All invoices settled", icon: Settings, color: "text-green-500 bg-green-500/10 border-green-500/20" }
      ];

      charts = {
        chart1: {
          title: "Arthur's Heart Rate Log",
          desc: "Average heart rate trends plotted over the last 24 hours.",
          labels: ["08:00", "12:00", "16:00", "20:00", "24:00"],
          pts: [
            { left: "0%", top: "73.3%", label: "08:00", val: "75 bpm" },
            { left: "25%", top: "66.7%", label: "12:00", val: "74 bpm" },
            { left: "50%", top: "80.0%", label: "16:00", val: "71 bpm" },
            { left: "75%", top: "46.7%", label: "20:00", val: "76 bpm" },
            { left: "100%", top: "33.3%", label: "24:00", val: "80 bpm" }
          ],
          svgPath: "M0,22 L25,20 L50,24 L75,14 L100,10 L100,30 L0,30 Z",
          linePath: "M0,22 L25,20 L50,24 L75,14 L100,10",
          color: "text-amber-500",
          gradId: "relativeGrad"
        },
        chart2: {
          title: "Nutrition & Hydration",
          desc: "Daily nutritional ingestion stats and hydration target met.",
          items: [
            { label: "Breakfast", val: 85, desc: "Whole oat cereal and fruit" },
            { label: "Lunch", val: 95, desc: "Vegetable broth and salmon grill" },
            { label: "Dinner", val: 80, desc: "Herb tea and chicken breast roast" },
            { label: "Hydration", val: 90, desc: "2.1 Liters of spring water" },
            { label: "Snacks", val: 60, desc: "Soft baked almond cookies" }
          ]
        },
        chart3: {
          title: "Arthur's Sleep & Rest",
          desc: "Hourly resting patterns logged over the last week.",
          days: [
            { day: "M", val: 7 },
            { day: "T", val: 8 },
            { day: "W", val: 6 },
            { day: "T", val: 8 },
            { day: "F", val: 7 },
            { day: "S", val: 9 },
            { day: "S", val: 8 }
          ]
        },
        chart4: {
          title: "Comfort Checklist Completion",
          desc: "Percentage of relative comfort checks completed by staff.",
          pct: pct,
          valText: `${pct}%`,
          labelText: `${doneTasks}/${totalTasks}`,
          subLabelText: "Ratio",
          hoverValText: `${pct}%`,
          hoverSubLabelText: "Done"
        },
        chart5: {
          title: "Sponsor Payment History",
          desc: "Stripe invoicing payments cleared for Arthur's care suite.",
          color: "text-green-500",
          labels: ["Mar", "Apr", "May", "Jun", "Jul"],
          pts: [
            { left: "0%", top: "93.3%", month: "Mar", val: "$1.8K paid" },
            { left: "25%", top: "60.0%", month: "Apr", val: "$1.8K paid" },
            { left: "50%", top: "73.3%", month: "May", val: "$1.8K paid" },
            { left: "75%", top: "26.7%", month: "Jun", val: "$1.8K paid" },
            { left: "100%", top: "16.7%", month: "Jul", val: "$1.8K paid" }
          ],
          linePath: "M0,28 L25,18 L50,22 L75,8 L100,5"
        }
      };
    }

    return (
      <div className="space-y-6 w-full text-left">
        {/* 7 COUNTING CARDS HEADER ROW */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-4 w-full">
          {cards.map((c, i) => {
            const CardIcon = c.icon;
            return (
              <div 
                key={i} 
                className={`glass-panel p-4 rounded-xl border flex flex-col justify-between hover:scale-[1.02] transition-transform ${c.color}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[9px] uppercase font-bold tracking-wider opacity-75">{c.label}</span>
                  <CardIcon className="w-4 h-4 opacity-80" />
                </div>
                <div className="mt-3">
                  <h4 className="text-sm font-extrabold tracking-tight truncate">{c.value}</h4>
                  <p className="text-[8px] opacity-75 font-light mt-0.5 truncate">{c.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* 5 DATA CHARTS CONTAINER */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full items-stretch">
          
          {/* Chart 1: Role-Specific Trend (Area Chart) */}
          <div className="glass-panel p-5 rounded-2xl border border-white/5 bg-background/50 lg:col-span-2 flex flex-col justify-between">
            <div>
              <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-1">{charts.chart1.title}</h4>
              <p className="text-[10px] text-muted-foreground font-light">{charts.chart1.desc}</p>
            </div>
            <div className="my-4 relative h-32 w-full">
              {/* Background SVG path */}
              <svg className={`w-full h-full ${charts.chart1.color}`} viewBox="0 0 100 30" preserveAspectRatio="none">
                <defs>
                  <linearGradient id={charts.chart1.gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path d={charts.chart1.svgPath} fill={`url(#${charts.chart1.gradId})`} />
                <path d={charts.chart1.linePath} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>

              {/* Absolute HTML dots and tooltips */}
              {charts.chart1.pts.map((pt: any, idx: number) => (
                <div 
                  key={idx} 
                  className="absolute group z-10 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                  style={{ left: pt.left, top: pt.top }}
                >
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500 border border-zinc-950 shadow-md group-hover:scale-125 transition-transform duration-150" />
                  
                  <div className={`absolute bottom-full mb-2 hidden group-hover:flex flex-col bg-zinc-950/95 border border-white/10 rounded px-2 py-1 text-[9px] text-foreground shadow-2xl whitespace-nowrap -translate-x-1/2 left-1/2`}>
                    <span className="font-semibold text-amber-500 text-[8px] leading-tight">{pt.label}</span>
                    <span className="text-[10px] font-extrabold mt-0.5 leading-none">{pt.val}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[8px] font-bold text-muted-foreground tracking-wider uppercase px-1">
              {charts.chart1.labels.map((lbl: string, idx: number) => (
                <span key={idx}>{lbl}</span>
              ))}
            </div>
          </div>

          {/* Chart 2: Role-Specific Allocation (Bar Chart) */}
          <div className="glass-panel p-5 rounded-2xl border border-white/5 bg-background/50 flex flex-col justify-between">
            <div>
              <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-1">{charts.chart2.title}</h4>
              <p className="text-[10px] text-muted-foreground font-light">{charts.chart2.desc}</p>
            </div>
            <div className="flex flex-col gap-3 justify-between h-32 pt-2 my-2">
              {charts.chart2.items.map((d: any, idx: number) => (
                <div key={`${idx}-${d.label}`} className="group flex items-center gap-2 text-[10px] relative">
                  <span className="w-16 text-muted-foreground text-left font-bold truncate">{d.label}</span>
                  <div className="flex-1 bg-foreground/5 border border-border/20 h-2 rounded-full overflow-hidden relative cursor-pointer">
                    <div className="bg-amber-500 h-full rounded-full transition-all duration-500 group-hover:bg-amber-400" style={{ width: `${d.val}%` }} />
                  </div>
                  <span className="w-6 text-right text-foreground font-semibold">{d.val}%</span>
                  
                  {/* Tooltip */}
                  <div className="absolute left-10 bottom-full mb-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none bg-zinc-950 border border-white/10 rounded px-1.5 py-0.5 text-[8px] text-foreground z-10 shadow-lg whitespace-nowrap">
                    {d.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chart 3: Role-Specific Incidents/Logs (Column Chart) */}
          <div className="glass-panel p-5 rounded-2xl border border-white/5 bg-background/50 flex flex-col justify-between">
            <div>
              <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-1">{charts.chart3.title}</h4>
              <p className="text-[10px] text-muted-foreground font-light">{charts.chart3.desc}</p>
            </div>
            <div className="flex justify-between items-end h-32 pt-4 px-2 border-b border-border/20 my-2">
              {charts.chart3.days.map((d: any, idx: number) => (
                <div key={`${idx}-${d.day}`} className="group relative flex flex-col items-center gap-1.5 w-6 cursor-pointer">
                  <div 
                    className={`w-full rounded-t transition-all duration-300 group-hover:scale-y-105 origin-bottom ${d.val > 1 ? "bg-red-500 group-hover:bg-red-400" : "bg-amber-500/80 group-hover:bg-amber-400"}`} 
                    style={{ height: `${(d.val + 0.1) * 12}px` }} 
                  />
                  <span className="text-[9px] text-muted-foreground font-bold">{d.day}</span>
                  
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none bg-zinc-950 border border-white/10 rounded px-2 py-0.5 text-[8px] text-foreground z-10 shadow-lg whitespace-nowrap">
                    {d.val} units logged
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chart 4: Role-Specific Progression (Radial Progress) */}
          <div className="glass-panel p-5 rounded-2xl border border-white/5 bg-background/50 flex flex-col justify-between">
            <div>
              <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-1">{charts.chart4.title}</h4>
              <p className="text-[10px] text-muted-foreground font-light">{charts.chart4.desc}</p>
            </div>
            <div className="relative w-32 h-32 mx-auto flex items-center justify-center my-2 group cursor-pointer">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                <path className="text-foreground/10" stroke="currentColor" strokeWidth="3" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path className="text-amber-500 transition-all duration-500" strokeDasharray={`${charts.chart4.pct}, 100`} stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              </svg>
              <div className="absolute text-center">
                <p className="text-lg font-extrabold text-foreground group-hover:hidden">{charts.chart4.valText}</p>
                <p className="text-xs font-extrabold text-amber-500 hidden group-hover:block">{charts.chart4.hoverValText}</p>
                <p className="text-[8px] text-muted-foreground uppercase font-bold tracking-wider group-hover:hidden">{charts.chart4.subLabelText}</p>
                <p className="text-[7px] text-muted-foreground uppercase font-bold tracking-wider hidden group-hover:block">{charts.chart4.hoverSubLabelText}</p>
              </div>
            </div>
          </div>

          {/* Chart 5: Role-Specific History (Spark Area Chart) */}
          <div className="glass-panel p-5 rounded-2xl border border-white/5 bg-background/50 flex flex-col justify-between">
            <div>
              <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-1">{charts.chart5.title}</h4>
              <p className="text-[10px] text-muted-foreground font-light">{charts.chart5.desc}</p>
            </div>
            <div className="flex flex-col justify-between h-32 pt-2 my-2 relative">
              <div className="relative h-16 w-full">
                <svg className={`w-full h-full ${charts.chart5.color}`} viewBox="0 0 100 30" preserveAspectRatio="none">
                  <path d={charts.chart5.linePath} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>

                {/* Absolute HTML dots and tooltips */}
                {charts.chart5.pts.map((pt: any, idx: number) => (
                  <div 
                    key={idx} 
                    className="absolute group z-10 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                    style={{ left: pt.left, top: pt.top }}
                  >
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500 border border-zinc-950 shadow-md group-hover:scale-125 transition-transform duration-150" />
                    
                    <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col bg-zinc-950/95 border border-white/10 rounded px-2 py-1 text-[9px] text-foreground shadow-2xl whitespace-nowrap -translate-x-1/2 left-1/2">
                      <span className="font-semibold text-green-500 text-[8px] leading-tight">{pt.month}</span>
                      <span className="text-[10px] font-extrabold mt-0.5 leading-none">{pt.val}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[8px] text-muted-foreground font-bold tracking-wider mt-2 border-t border-border/10 pt-2 px-1">
                {charts.chart5.labels.map((lbl: string, idx: number) => (
                  <span key={idx}>{lbl}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Switch Main Dashboard Panels dynamically based on active tab
  const renderTabContent = () => {
    // -------------------------------------------------------------
    // HEAD NURSE TABS
    // -------------------------------------------------------------
    if (activeRole === "NURSE") {
      switch (activeTab) {
        case "Clinical Dashboard":
          return renderUnifiedDashboard();

        case "Vitals Monitor":
          return (
            <>
              {/* Full-width camera panel */}
              <div className="glass-panel p-6 rounded-2xl flex flex-col gap-6 text-left border-white/5 light:border-black/5 shadow-md bg-background/50 w-full">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-lg font-bold tracking-tight text-foreground">Optical Matrix Feed</h3>
                    <p className="text-xs text-muted-foreground font-light mt-0.5">Real-time edge computer vision safety analysis.</p>
                  </div>
                  <button
                    onClick={() => setShowVitalsModal(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-all cursor-pointer"
                  >
                    <Activity className="w-4 h-4" />
                    View Vitals Log
                  </button>
                </div>
                <hr className="border-border/50" />
                <CameraVisionFeed isFallen={isFallen} onFallTriggered={triggerFallAlert} />
              </div>

              {/* Vitals Log Modal */}
              <AnimatePresence>
                {showVitalsModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 20 }}
                      transition={{ type: "spring", duration: 0.3 }}
                      className="w-full max-w-lg rounded-2xl p-6 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 border border-amber-500/30 shadow-2xl shadow-amber-500/10 flex flex-col gap-4"
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                            <Activity className="w-5 h-5 text-amber-500" /> Vitals Telemetry
                          </h3>
                          <p className="text-[11px] text-muted-foreground mt-0.5">Logs captured from medical nodes and voice transcription.</p>
                        </div>
                        <button
                          onClick={() => setShowVitalsModal(false)}
                          className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-foreground cursor-pointer transition-all"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <hr className="border-amber-500/20" />
                      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                        {vitalsLogs.map(log => (
                          <div key={log.id} className="p-3.5 rounded-xl bg-foreground/5 border border-border flex flex-col gap-2 transition-all hover:bg-foreground/10">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-xs font-bold">{log.name}</p>
                                <p className="text-[9px] text-muted-foreground">Suite {log.room}</p>
                              </div>
                              <span className="text-[9px] text-muted-foreground">{log.time}</span>
                            </div>
                            <div className="flex items-center justify-between bg-background/50 p-2 rounded-lg border border-border/5 text-xs">
                              <span className="text-muted-foreground font-light">{log.type}:</span>
                              <span className={`font-bold ${log.status === "Critical" ? "text-red-500" : "text-amber-500"}`}>{log.value}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
            </>
          );

        case "Incident Log": {
          const itemsPerPage = 5;
          const [isSearchListening, setIsSearchListening] = useState(false);
          const [showSearchModal, setShowSearchModal] = useState(false);

          const getSearchAISummary = (query: string, matches: typeof incidents) => {
            if (matches.length === 0) {
              return `The search query "${query}" returned no matching incident logs in the system database. Verify the spelling or try searching for a different resident name, room number, or incident type.`;
            }

            const total = matches.length;
            const resolvedCount = matches.filter(m => m.status === "Resolved").length;
            const activeCount = total - resolvedCount;
            const criticalCount = matches.filter(m => m.severity === "Critical").length;
            const warningCount = matches.filter(m => m.severity === "Warning").length;

            const residentNames = Array.from(new Set(matches.map(m => m.resident))).join(", ");
            const rooms = Array.from(new Set(matches.map(m => m.room))).join(", ");
            const types = Array.from(new Set(matches.map(m => m.type))).join(", ");

            return `Search for "${query}" matched ${total} record(s) involving resident(s) [${residentNames}] in room(s) [${rooms}]. The incidents recorded include [${types}]. Out of these, ${resolvedCount} is/are resolved and ${activeCount} is/are active. In terms of severity, there are ${criticalCount} critical alert(s) and ${warningCount} warning(s) logged.`;
          };

          const toggleSearchVoice = () => {
            if (isSearchListening) {
              if ((window as any)._searchRecognition) {
                (window as any)._searchRecognition.stop();
              }
              setIsSearchListening(false);
              return;
            }

            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (!SpeechRecognition) {
              alert("Speech recognition is not supported in this browser.");
              return;
            }

            const recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.lang = "en-US";

            recognition.onstart = () => {
              setIsSearchListening(true);
            };

            recognition.onresult = (event: any) => {
              const transcript = event.results[0][0].transcript;
              let cleanQuery = transcript.trim();
              if (cleanQuery.toLowerCase().startsWith("search for ")) {
                cleanQuery = cleanQuery.slice(11);
              } else if (cleanQuery.toLowerCase().startsWith("find ")) {
                cleanQuery = cleanQuery.slice(5);
              }
              if (cleanQuery.endsWith(".")) {
                cleanQuery = cleanQuery.slice(0, -1);
              }
              
              setSearchTerm(cleanQuery);
              setCurrentPage(1);
              setShowSearchModal(true); // Automatically show modal!

              const matches = incidents.filter(inc =>
                inc.resident.toLowerCase().includes(cleanQuery.toLowerCase()) ||
                inc.room.toLowerCase().includes(cleanQuery.toLowerCase()) ||
                inc.type.toLowerCase().includes(cleanQuery.toLowerCase())
              );

              const speakText = getSearchAISummary(cleanQuery, matches);

              if ("speechSynthesis" in window) {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(speakText);
                utterance.rate = 1.0;
                utterance.pitch = 1.0;
                window.speechSynthesis.speak(utterance);
              }
            };

            recognition.onerror = (event: any) => {
              console.error("Search speech recognition error", event);
              setIsSearchListening(false);
            };

            recognition.onend = () => {
              setIsSearchListening(false);
            };

            (window as any)._searchRecognition = recognition;
            recognition.start();
          };

          const filteredIncidents = incidents.filter(inc =>
            inc.resident.toLowerCase().includes(searchTerm.toLowerCase()) ||
            inc.room.toLowerCase().includes(searchTerm.toLowerCase()) ||
            inc.type.toLowerCase().includes(searchTerm.toLowerCase())
          );

          const totalPages = Math.ceil(filteredIncidents.length / itemsPerPage);
          const paginatedIncidents = filteredIncidents.slice(
            (currentPage - 1) * itemsPerPage,
            currentPage * itemsPerPage
          );

          const isAllSelected = paginatedIncidents.length > 0 &&
            paginatedIncidents.every(inc => selectedIncidents.has(inc.id));

          const handleSelectAll = () => {
            const newSelected = new Set(selectedIncidents);
            if (isAllSelected) {
              paginatedIncidents.forEach(inc => newSelected.delete(inc.id));
            } else {
              paginatedIncidents.forEach(inc => newSelected.add(inc.id));
            }
            setSelectedIncidents(newSelected);
          };

          const handleSelectIncident = (id: number) => {
            const newSelected = new Set(selectedIncidents);
            if (newSelected.has(id)) {
              newSelected.delete(id);
            } else {
              newSelected.add(id);
            }
            setSelectedIncidents(newSelected);
          };

          const handleDeleteSelected = () => {
            setIncidents(incidents.filter(inc => !selectedIncidents.has(inc.id)));
            setSelectedIncidents(new Set());
          };

          const exportToCSV = () => {
            const headers = ["ID", "Resident", "Room", "Type", "Severity", "Time", "Status"];
            const rows = filteredIncidents.map(inc => [
              inc.id,
              inc.resident,
              inc.room,
              inc.type,
              inc.severity,
              inc.time,
              inc.status
            ]);
            const csvContent = [
              headers.join(","),
              ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
            ].join("\n");
            const blob = new Blob([csvContent], { type: "text/csv" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `incidents_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
          };

          const exportToExcel = () => {
            const headers = ["ID", "Resident", "Room", "Type", "Severity", "Time", "Status"];
            const rows = filteredIncidents.map(inc => [inc.id, inc.resident, inc.room, inc.type, inc.severity, inc.time, inc.status]);
            let excel = "ID\tResident\tRoom\tType\tSeverity\tTime\tStatus\n";
            rows.forEach(row => { excel += row.join("\t") + "\n"; });
            const blob = new Blob([excel], { type: "application/vnd.ms-excel" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `incidents_${new Date().toISOString().split('T')[0]}.xls`;
            a.click();
          };

          const exportToPDF = () => {
            const content = filteredIncidents.map(inc =>
              `${inc.resident} | Room: ${inc.room} | ${inc.type} | ${inc.severity} | ${inc.time} | ${inc.status}`
            ).join("\n");
            const pdf = `INCIDENT REPORT\n${new Date().toLocaleDateString()}\n\n${content}`;
            const blob = new Blob([pdf], { type: "application/pdf" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `incidents_${new Date().toISOString().split('T')[0]}.pdf`;
            a.click();
          };

          const exportToDOCX = () => {
            const content = filteredIncidents.map(inc =>
              `${inc.resident} | Room: ${inc.room} | ${inc.type} | ${inc.severity} | ${inc.time} | ${inc.status}`
            ).join("\n");
            const docContent = `INCIDENT REPORT\n${new Date().toLocaleDateString()}\n\n${content}`;
            const blob = new Blob([docContent], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `incidents_${new Date().toISOString().split('T')[0]}.docx`;
            a.click();
          };

          return (
            <div className="space-y-4 w-full max-w-7xl">
              {/* BREADCRUMBS */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-2">
                <button onClick={() => router.push("/nurse/dashboard")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                  <Home className="w-3.5 h-3.5" /> Dashboard
                </button>
                <ChevronRight className="w-3 h-3" />
                <span className="text-foreground font-semibold">Incident Log</span>
              </div>

              <div className="glass-panel p-6 rounded-2xl text-left border-white/5 light:border-black/5 shadow-md bg-background/50 w-full space-y-4">
              <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold tracking-tight text-foreground">Incident Reports & Logs</h3>
                  <p className="text-xs text-muted-foreground font-light mt-0.5">Historical and active safety dispatcher tracking logs.</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* EXPORT DROPDOWN */}
                  <div className="relative">
                    <button
                      onClick={() => setExportOpen(!exportOpen)}
                      className="px-3 py-1.5 rounded-lg border border-border bg-foreground/5 text-foreground text-[10px] hover:bg-foreground/10 transition-all cursor-pointer font-semibold flex items-center gap-2"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export
                      <ChevronDown className={`w-3 h-3 transition-transform ${exportOpen ? "rotate-180" : ""}`} />
                    </button>
                    {exportOpen && (
                      <div className="absolute right-0 mt-2 w-40 bg-background border border-border rounded-lg shadow-lg z-10 overflow-hidden">
                        <button
                          onClick={() => { exportToCSV(); setExportOpen(false); }}
                          className="w-full px-4 py-2 text-left text-[10px] hover:bg-foreground/5 transition-colors font-semibold text-foreground border-b border-border/50"
                        >
                          📊 Export to CSV
                        </button>
                        <button
                          onClick={() => { exportToExcel(); setExportOpen(false); }}
                          className="w-full px-4 py-2 text-left text-[10px] hover:bg-foreground/5 transition-colors font-semibold text-foreground border-b border-border/50"
                        >
                          📈 Export to Excel
                        </button>
                        <button
                          onClick={() => { exportToPDF(); setExportOpen(false); }}
                          className="w-full px-4 py-2 text-left text-[10px] hover:bg-foreground/5 transition-colors font-semibold text-foreground border-b border-border/50"
                        >
                          📄 Export to PDF
                        </button>
                        <button
                          onClick={() => { exportToDOCX(); setExportOpen(false); }}
                          className="w-full px-4 py-2 text-left text-[10px] hover:bg-foreground/5 transition-colors font-semibold text-foreground"
                        >
                          📝 Export to DOCX
                        </button>
                      </div>
                    )}
                  </div>

                  {selectedIncidents.size > 0 && (
                    <button
                      onClick={handleDeleteSelected}
                      className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-500 border border-red-500/30 text-[10px] hover:bg-red-500/25 transition-all cursor-pointer font-semibold"
                    >
                      Delete ({selectedIncidents.size})
                    </button>
                  )}
                  <button
                    onClick={() => { setIncidents([]); setSelectedIncidents(new Set()); }}
                    className="px-3 py-1.5 rounded-lg border border-border text-[10px] hover:bg-foreground/5 transition-all cursor-pointer font-semibold"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by resident, room, or type..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                  className="w-full pl-9 pr-32 py-2 text-xs rounded-xl bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setShowSearchModal(true)}
                      title="Show Search AI Insights"
                      className="px-2 py-1 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold hover:bg-amber-500/30 transition-all cursor-pointer"
                    >
                      AI Summary
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={toggleSearchVoice}
                    title="Search by voice"
                    className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                      isSearchListening 
                        ? "bg-red-500/20 border-red-500 text-red-500 animate-pulse shadow-md shadow-red-500/10" 
                        : "border-border bg-foreground/5 text-muted-foreground hover:text-foreground hover:bg-foreground/10"
                    }`}
                  >
                    <Mic className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* MOBILE CARD VIEW */}
              <div className="block md:hidden space-y-4 w-full">
                {filteredIncidents.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground font-light italic border border-dashed border-border rounded-xl bg-foreground/2">
                    No incidents found.
                  </div>
                ) : (
                  paginatedIncidents.map((incident) => (
                    <div 
                      key={incident.id} 
                      className={`p-4 rounded-xl border flex flex-col gap-3 transition-all hover:bg-foreground/5 ${
                        selectedIncidents.has(incident.id) ? "bg-amber-500/10 border-amber-500/30" : "bg-foreground/5 border-border"
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={selectedIncidents.has(incident.id)}
                            onChange={() => handleSelectIncident(incident.id)}
                            className="w-4 h-4 rounded cursor-pointer shrink-0"
                          />
                          <div>
                            <h4 className="text-sm font-bold text-foreground">{incident.resident}</h4>
                            <p className="text-[10px] text-muted-foreground">Room {incident.room}</p>
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                          incident.severity === "Critical"
                            ? "bg-red-500/10 text-red-500 border border-red-500/20"
                            : incident.severity === "Warning"
                            ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                            : "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20"
                        }`}>
                          {incident.severity}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center text-xs">
                        <div>
                          <p className="text-[9px] text-muted-foreground">Type</p>
                          <p className="font-semibold text-foreground">{incident.type}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] text-muted-foreground">Time</p>
                          <p className="text-muted-foreground font-light">{incident.time}</p>
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-2 border-t border-border/10">
                        <span className={`text-[10px] font-bold ${
                          incident.status === "Resolved" ? "text-green-500" : "text-red-500 animate-pulse"
                        }`}>
                          {incident.status}
                        </span>
                        <button
                          onClick={() => {
                            setEditModalData(incident);
                            setEditModalType("incident");
                            setEditModalOpen(true);
                          }}
                          className="text-[10px] px-2.5 py-1 rounded bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-all border border-amber-500/20 font-semibold"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* DESKTOP TABLE VIEW */}
              <div className="hidden md:block overflow-x-auto w-full">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border/50 text-muted-foreground uppercase font-bold tracking-wider text-[10px]">
                      <th className="py-3 px-3">
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={handleSelectAll}
                          className="w-4 h-4 rounded cursor-pointer"
                        />
                      </th>
                      <th className="py-3 px-2">Resident</th>
                      <th className="py-3 px-2">Room</th>
                      <th className="py-3 px-2">Type</th>
                      <th className="py-3 px-2">Severity</th>
                      <th className="py-3 px-2">Time</th>
                      <th className="py-3 px-2">Status</th>
                      <th className="py-3 px-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIncidents.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-muted-foreground font-light italic">
                          No incidents found.
                        </td>
                      </tr>
                    ) : (
                      paginatedIncidents.map((incident) => (
                        <Fragment key={incident.id}>
                          <tr
                            className={`border-b border-border/20 hover:bg-foreground/5 transition-all ${
                              selectedIncidents.has(incident.id) ? "bg-amber-500/10" : ""
                            }`}
                          >
                            <td className="py-3 px-3">
                              <input
                                type="checkbox"
                                checked={selectedIncidents.has(incident.id)}
                                onChange={() => handleSelectIncident(incident.id)}
                                className="w-4 h-4 rounded cursor-pointer"
                              />
                            </td>
                            <td className="py-3 px-2 font-semibold text-foreground">{incident.resident}</td>
                            <td className="py-3 px-2">{incident.room}</td>
                            <td className="py-3 px-2">{incident.type}</td>
                            <td className="py-3 px-2">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                                incident.severity === "Critical"
                                  ? "bg-red-500/10 text-red-500 border border-red-500/20"
                                  : incident.severity === "Warning"
                                  ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                                  : "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20"
                              }`}>
                                {incident.severity}
                              </span>
                            </td>
                            <td className="py-3 px-2 text-muted-foreground font-light">{incident.time}</td>
                            <td className="py-3 px-2">
                              <span className={`text-[10px] font-bold ${
                                incident.status === "Resolved" ? "text-green-500" : "text-red-500 animate-pulse"
                              }`}>
                                {incident.status}
                              </span>
                            </td>
                            <td className="py-3 px-2">
                              <button
                                onClick={() => setEditingId(editingId === incident.id ? null : incident.id)}
                                className="text-[10px] px-2 py-1 rounded bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-all border border-amber-500/20 font-semibold"
                              >
                                {editingId === incident.id ? "Close" : "Edit"}
                              </button>
                            </td>
                          </tr>
                          {editingId === incident.id && (
                            <tr className="bg-foreground/5 border-b border-border/20">
                              <td colSpan={8} className="p-4">
                                <div className="flex gap-4 items-center">
                                  <span className="text-xs font-semibold text-foreground">Edit Incident:</span>
                                  <div className="flex items-center gap-2">
                                    <label className="text-[10px] text-muted-foreground uppercase">Severity</label>
                                    <select
                                      value={incident.severity}
                                      onChange={(e) => {
                                        setIncidents(incidents.map(inc => inc.id === incident.id ? { ...inc, severity: e.target.value } : inc));
                                      }}
                                      className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-amber-500"
                                    >
                                      <option value="Info">Info</option>
                                      <option value="Warning">Warning</option>
                                      <option value="Critical">Critical</option>
                                    </select>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <label className="text-[10px] text-muted-foreground uppercase">Status</label>
                                    <select
                                      value={incident.status}
                                      onChange={(e) => {
                                        setIncidents(incidents.map(inc => inc.id === incident.id ? { ...inc, status: e.target.value } : inc));
                                      }}
                                      className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-amber-500"
                                    >
                                      <option value="Dispatched">Dispatched</option>
                                      <option value="Resolved">Resolved</option>
                                    </select>
                                  </div>
                                  <button
                                    onClick={() => setEditingId(null)}
                                    className="ml-auto text-[10px] px-3 py-1.5 bg-amber-500 text-background rounded hover:bg-amber-600 transition-colors font-bold"
                                  >
                                    Save
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Showing {paginatedIncidents.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} - {Math.min(currentPage * itemsPerPage, filteredIncidents.length)} of {filteredIncidents.length}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1.5 rounded-lg border border-border text-[10px] hover:bg-foreground/5 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer font-semibold"
                    >
                      Previous
                    </button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }).map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setCurrentPage(i + 1)}
                          className={`px-2 py-1 rounded text-[10px] font-semibold transition-all ${
                            currentPage === i + 1
                              ? "bg-amber-500 text-background"
                              : "border border-border hover:bg-foreground/5"
                          }`}
                        >
                          {i + 1}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1.5 rounded-lg border border-border text-[10px] hover:bg-foreground/5 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer font-semibold"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
              {/* Search AI Insights Modal */}
              <AnimatePresence>
                {showSearchModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 20 }}
                      transition={{ type: "spring", duration: 0.3 }}
                      className="w-full max-w-2xl rounded-2xl p-6 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 border border-amber-500/30 shadow-2xl shadow-amber-500/10 flex flex-col gap-4 text-left"
                    >
                      {/* Modal Header */}
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <Cpu className="w-5 h-5 text-amber-500" />
                          <div>
                            <h3 className="text-base font-bold text-foreground">AI Search Summary</h3>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Query response for: <span className="text-amber-400 font-mono">"{searchTerm}"</span>
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setShowSearchModal(false)}
                          className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-foreground cursor-pointer transition-all"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <hr className="border-amber-500/20" />

                      {/* Summary Description Box */}
                      <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/15 text-xs text-foreground/90 font-light leading-relaxed">
                        <h4 className="font-bold text-amber-400 mb-1 flex items-center gap-1">
                          🤖 AI Executive Summary
                        </h4>
                        <p>{getSearchAISummary(searchTerm, filteredIncidents)}</p>
                      </div>

                      {/* Results List */}
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                          Matching Incident Details
                        </h4>
                        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                          {filteredIncidents.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic text-center py-6">
                              No matching incident logs.
                            </p>
                          ) : (
                            filteredIncidents.map((incident) => (
                              <div
                                key={incident.id}
                                className="p-3 rounded-xl bg-foreground/5 border border-border flex items-center justify-between gap-4"
                              >
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-foreground">{incident.resident}</span>
                                    <span className="text-[9px] text-muted-foreground">Room {incident.room}</span>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground mt-1">
                                    Type: <span className="font-semibold text-foreground">{incident.type}</span> • Time: <span className="font-light">{incident.time}</span>
                                  </p>
                                </div>
                                <div className="flex items-center gap-2.5">
                                  <span className={`px-2 py-0.5 rounded text-[8px] font-bold ${
                                    incident.severity === "Critical"
                                      ? "bg-red-500/10 text-red-500 border border-red-500/20"
                                      : incident.severity === "Warning"
                                      ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                                      : "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20"
                                  }`}>
                                    {incident.severity}
                                  </span>
                                  <span className={`text-[10px] font-bold ${
                                    incident.status === "Resolved" ? "text-green-500" : "text-red-500 animate-pulse"
                                  }`}>
                                    {incident.status}
                                  </span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Modal Footer / Speak Again */}
                      <div className="flex gap-2.5 justify-end mt-2 pt-4 border-t border-border/50">
                        <button
                          onClick={() => {
                            if ("speechSynthesis" in window) {
                              window.speechSynthesis.cancel();
                              const utterance = new SpeechSynthesisUtterance(getSearchAISummary(searchTerm, filteredIncidents));
                              utterance.rate = 1.0;
                              utterance.pitch = 1.0;
                              window.speechSynthesis.speak(utterance);
                            }
                          }}
                          className="px-3.5 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                        >
                          <Mic className="w-3.5 h-3.5" /> Speak Summary
                        </button>
                        <button
                          onClick={() => setShowSearchModal(false)}
                          className="px-4 py-2 rounded-xl bg-foreground text-background text-xs font-bold hover:scale-[1.01] transition-all cursor-pointer"
                        >
                          Close
                        </button>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
            </div>
            </div>
          );
        }


        case "Resident Records": {
          const resItemsPerPage = 5;

          const filteredRecords = residentRecords.filter(rec =>
            rec.name.toLowerCase().includes(researchTerm.toLowerCase()) ||
            rec.room.toLowerCase().includes(researchTerm.toLowerCase()) ||
            rec.care.toLowerCase().includes(researchTerm.toLowerCase())
          );

          const resTotalPages = Math.ceil(filteredRecords.length / resItemsPerPage);
          const resPaginatedRecords = filteredRecords.slice(
            (resCurrentPage - 1) * resItemsPerPage,
            resCurrentPage * resItemsPerPage
          );

          const resIsAllSelected = resPaginatedRecords.length > 0 &&
            resPaginatedRecords.every(rec => selectedRecords.has(rec.id));

          const handleResSelectAll = () => {
            const newSelected = new Set(selectedRecords);
            if (resIsAllSelected) {
              resPaginatedRecords.forEach(rec => newSelected.delete(rec.id));
            } else {
              resPaginatedRecords.forEach(rec => newSelected.add(rec.id));
            }
            setSelectedRecords(newSelected);
          };

          const handleResSelectRecord = (id: number) => {
            const newSelected = new Set(selectedRecords);
            if (newSelected.has(id)) {
              newSelected.delete(id);
            } else {
              newSelected.add(id);
            }
            setSelectedRecords(newSelected);
          };

          const handleResDeleteSelected = async () => {
            const count = selectedRecords.size;
            const result = await Swal.fire({
              title: "Delete Record(s)?",
              html: `<p>Are you sure you want to permanently delete <strong>${count}</strong> resident record${count !== 1 ? "s" : ""}?</p><p style="color: #999; font-size: 0.9em; margin-top: 8px;">This action cannot be undone.</p>`,
              icon: "warning",
              showCancelButton: true,
              confirmButtonColor: "#ef4444",
              cancelButtonColor: "#6b7280",
              confirmButtonText: "Delete",
              cancelButtonText: "Cancel",
              background: "#18181b",
              color: "#fafafa",
              customClass: {
                popup: "rounded-2xl border border-red-500/30",
                title: "text-lg font-bold",
                confirmButton: "px-4 py-2 rounded-lg font-semibold text-sm",
                cancelButton: "px-4 py-2 rounded-lg font-semibold text-sm"
              }
            });

            if (result.isConfirmed) {
              setResidentRecords(residentRecords.filter(rec => !selectedRecords.has(rec.id)));
              setSelectedRecords(new Set());
              Swal.fire({
                title: "Deleted!",
                text: `${count} record${count !== 1 ? "s" : ""} deleted successfully.`,
                icon: "success",
                confirmButtonColor: "#ea580c",
                background: "#18181b",
                color: "#fafafa",
                customClass: {
                  confirmButton: "px-4 py-2 rounded-lg font-semibold text-sm"
                }
              });
            }
          };

          const getResSearchAISummary = (query: string, matches: typeof filteredRecords) => {
            if (matches.length === 0) {
              return `The search query "${query}" returned no matching resident records in the system database. Verify the spelling or try searching for a different resident name, room number, or care level.`;
            }

            const total = matches.length;
            const names = Array.from(new Set(matches.map(m => m.name))).join(", ");
            const rooms = Array.from(new Set(matches.map(m => m.room))).join(", ");
            const careLevels = Array.from(new Set(matches.map(m => m.care))).join(", ");
            const sponsors = Array.from(new Set(matches.map(m => m.sponsor))).join(", ");

            return `Search for "${query}" matched ${total} resident record${total !== 1 ? "s" : ""} involving resident${total !== 1 ? "s" : ""} [${names}] in room${total !== 1 ? "s" : ""} [${rooms}]. Care level${total !== 1 ? "s" : ""}: [${careLevels}]. Primary sponsor${total !== 1 ? "s" : ""}: [${sponsors}].`;
          };

          const exportResidentsCSV = () => {
            const headers = ["Name", "Room", "Care Level", "Sponsor", "Medications", "Status"];
            const rows = filteredRecords.map(rec => [rec.name, rec.room, rec.care, rec.sponsor, rec.medications, rec.status]);
            const csvContent = [
              headers.join(","),
              ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
            ].join("\n");
            const blob = new Blob([csvContent], { type: "text/csv" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `residents_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
          };

          const exportResidentsExcel = () => {
            const headers = ["Name", "Room", "Care Level", "Sponsor", "Medications", "Status"];
            const rows = filteredRecords.map(rec => [rec.name, rec.room, rec.care, rec.sponsor, rec.medications, rec.status]);
            let excel = headers.join("\t") + "\n";
            rows.forEach(row => { excel += row.join("\t") + "\n"; });
            const blob = new Blob([excel], { type: "application/vnd.ms-excel" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `residents_${new Date().toISOString().split('T')[0]}.xls`;
            a.click();
          };

          const exportResidentsPDF = () => {
            const content = filteredRecords.map(rec =>
              `${rec.name} | Room: ${rec.room} | Care: ${rec.care} | Sponsor: ${rec.sponsor} | Status: ${rec.status}`
            ).join("\n");
            const pdf = `RESIDENT RECORDS\n${new Date().toLocaleDateString()}\n\n${content}`;
            const blob = new Blob([pdf], { type: "application/pdf" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `residents_${new Date().toISOString().split('T')[0]}.pdf`;
            a.click();
          };

          const exportResidentsDOCX = () => {
            const content = filteredRecords.map(rec =>
              `${rec.name} | Room: ${rec.room} | Care: ${rec.care} | Sponsor: ${rec.sponsor} | Status: ${rec.status}`
            ).join("\n");
            const docContent = `RESIDENT RECORDS\n${new Date().toLocaleDateString()}\n\n${content}`;
            const blob = new Blob([docContent], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `residents_${new Date().toISOString().split('T')[0]}.docx`;
            a.click();
          };

          return (
            <div className="space-y-4 w-full max-w-7xl">
              {/* BREADCRUMBS */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-2">
                <button onClick={() => router.push("/nurse/dashboard")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                  <Home className="w-3.5 h-3.5" /> Dashboard
                </button>
                <ChevronRight className="w-3 h-3" />
                <span className="text-foreground font-semibold">Resident Records</span>
              </div>

              <div className="glass-panel p-6 rounded-2xl text-left border-white/5 light:border-black/5 shadow-md bg-background/50 w-full space-y-4">
                <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold tracking-tight text-foreground">Secure Resident Directory</h3>
                    <p className="text-xs text-muted-foreground font-light mt-0.5">Protected clinical listings of facility residents.</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* EXPORT DROPDOWN */}
                    <div className="relative">
                      <button
                        onClick={() => setResExportOpen(!resExportOpen)}
                        className="px-3 py-1.5 rounded-lg border border-border bg-foreground/5 text-foreground text-[10px] hover:bg-foreground/10 transition-all cursor-pointer font-semibold flex items-center gap-2"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Export
                        <ChevronDown className={`w-3 h-3 transition-transform ${resExportOpen ? "rotate-180" : ""}`} />
                      </button>
                      {resExportOpen && (
                        <div className="absolute right-0 mt-2 w-40 bg-background border border-border rounded-lg shadow-lg z-10 overflow-hidden">
                          <button
                            onClick={() => { exportResidentsCSV(); setResExportOpen(false); }}
                            className="w-full px-4 py-2 text-left text-[10px] hover:bg-foreground/5 transition-colors font-semibold text-foreground border-b border-border/50"
                          >
                            📊 Export to CSV
                          </button>
                          <button
                            onClick={() => { exportResidentsExcel(); setResExportOpen(false); }}
                            className="w-full px-4 py-2 text-left text-[10px] hover:bg-foreground/5 transition-colors font-semibold text-foreground border-b border-border/50"
                          >
                            📈 Export to Excel
                          </button>
                          <button
                            onClick={() => { exportResidentsPDF(); setResExportOpen(false); }}
                            className="w-full px-4 py-2 text-left text-[10px] hover:bg-foreground/5 transition-colors font-semibold text-foreground border-b border-border/50"
                          >
                            📄 Export to PDF
                          </button>
                          <button
                            onClick={() => { exportResidentsDOCX(); setResExportOpen(false); }}
                            className="w-full px-4 py-2 text-left text-[10px] hover:bg-foreground/5 transition-colors font-semibold text-foreground"
                          >
                            📝 Export to DOCX
                          </button>
                        </div>
                      )}
                    </div>

                    {selectedRecords.size > 0 && (
                      <button
                        onClick={handleResDeleteSelected}
                        className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-500 border border-red-500/30 text-[10px] hover:bg-red-500/25 transition-all cursor-pointer font-semibold"
                      >
                        Delete ({selectedRecords.size})
                      </button>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search by name, room, or care level..."
                    value={researchTerm}
                    onChange={(e) => { setResearchTerm(e.target.value); setResCurrentPage(1); }}
                    className="w-full pl-9 pr-32 py-2 text-xs rounded-xl bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                  />
                  {researchTerm && (
                    <button
                      type="button"
                      onClick={() => setShowResSearchModal(true)}
                      title="Show Search AI Insights"
                      className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold hover:bg-amber-500/30 transition-all cursor-pointer"
                    >
                      AI Summary
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto w-full">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border/50 text-muted-foreground uppercase font-bold tracking-wider text-[10px]">
                        <th className="py-3 px-3">
                          <input
                            type="checkbox"
                            checked={resIsAllSelected}
                            onChange={handleResSelectAll}
                            className="w-4 h-4 rounded cursor-pointer"
                          />
                        </th>
                        <th className="py-3 px-2">Name</th>
                        <th className="py-3 px-2">Room</th>
                        <th className="py-3 px-2">Care Level</th>
                        <th className="py-3 px-2">Sponsor</th>
                        <th className="py-3 px-2">Status</th>
                        <th className="py-3 px-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecords.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-muted-foreground font-light italic">
                            No resident records found.
                          </td>
                        </tr>
                      ) : (
                        resPaginatedRecords.map((record) => (
                          <tr
                            key={record.id}
                            className={`border-b border-border/20 hover:bg-foreground/5 transition-all ${
                              selectedRecords.has(record.id) ? "bg-amber-500/10" : ""
                            }`}
                          >
                            <td className="py-3 px-3">
                              <input
                                type="checkbox"
                                checked={selectedRecords.has(record.id)}
                                onChange={() => handleResSelectRecord(record.id)}
                                className="w-4 h-4 rounded cursor-pointer"
                              />
                            </td>
                            <td className="py-3 px-2 font-semibold text-foreground">{record.name}</td>
                            <td className="py-3 px-2">{record.room}</td>
                            <td className="py-3 px-2">
                              <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-blue-500/10 text-blue-500 border border-blue-500/20">
                                {record.care}
                              </span>
                            </td>
                            <td className="py-3 px-2 text-muted-foreground font-light text-[10px]">{record.sponsor}</td>
                            <td className="py-3 px-2">
                              <span className="text-[10px] font-bold text-green-500">
                                ✓ {record.status}
                              </span>
                            </td>
                            <td className="py-3 px-2">
                              <button
                                onClick={() => {
                                  setEditModalData(record);
                                  setEditModalType("resident");
                                  setEditModalOpen(true);
                                }}
                                className="text-[10px] px-2 py-1 rounded bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-all border border-amber-500/20 font-semibold"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {resTotalPages > 1 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Showing {resPaginatedRecords.length > 0 ? (resCurrentPage - 1) * resItemsPerPage + 1 : 0} - {Math.min(resCurrentPage * resItemsPerPage, filteredRecords.length)} of {filteredRecords.length}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setResCurrentPage(Math.max(1, resCurrentPage - 1))}
                        disabled={resCurrentPage === 1}
                        className="px-3 py-1.5 rounded-lg border border-border text-[10px] hover:bg-foreground/5 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer font-semibold"
                      >
                        Previous
                      </button>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: resTotalPages }).map((_, i) => (
                          <button
                            key={i}
                            onClick={() => setResCurrentPage(i + 1)}
                            className={`px-2 py-1 rounded text-[10px] font-semibold transition-all ${
                              resCurrentPage === i + 1
                                ? "bg-amber-500 text-background"
                                : "border border-border hover:bg-foreground/5"
                            }`}
                          >
                            {i + 1}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => setResCurrentPage(Math.min(resTotalPages, resCurrentPage + 1))}
                        disabled={resCurrentPage === resTotalPages}
                        className="px-3 py-1.5 rounded-lg border border-border text-[10px] hover:bg-foreground/5 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer font-semibold"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Resident Search AI Insights Modal */}
              <AnimatePresence>
                {showResSearchModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 20 }}
                      transition={{ type: "spring", duration: 0.3 }}
                      className="w-full max-w-2xl rounded-2xl p-6 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 border border-amber-500/30 shadow-2xl shadow-amber-500/10 flex flex-col gap-4 text-left"
                    >
                      {/* Modal Header */}
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <Cpu className="w-5 h-5 text-amber-500" />
                          <div>
                            <h3 className="text-base font-bold text-foreground">AI Search Summary</h3>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Query response for: <span className="text-amber-400 font-mono">"{researchTerm}"</span>
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setShowResSearchModal(false)}
                          className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-foreground cursor-pointer transition-all"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <hr className="border-amber-500/20" />

                      {/* Summary Description Box */}
                      <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/15 text-xs text-foreground/90 font-light leading-relaxed">
                        <h4 className="font-bold text-amber-400 mb-1 flex items-center gap-1">
                          🤖 AI Executive Summary
                        </h4>
                        <p>{getResSearchAISummary(researchTerm, filteredRecords)}</p>
                      </div>

                      {/* Results List */}
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                          Matching Resident Records
                        </h4>
                        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                          {filteredRecords.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic text-center py-6">
                              No matching resident records.
                            </p>
                          ) : (
                            filteredRecords.map((record) => (
                              <div
                                key={record.id}
                                className="p-3 rounded-xl bg-foreground/5 border border-border flex items-center justify-between gap-4"
                              >
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-foreground">{record.name}</span>
                                    <span className="text-[9px] text-muted-foreground">Room {record.room}</span>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground mt-1">
                                    Care: <span className="font-semibold text-foreground">{record.care}</span> • Sponsor: <span className="font-light">{record.sponsor}</span>
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="px-2 py-0.5 rounded text-[8px] font-bold bg-blue-500/10 text-blue-500 border border-blue-500/20">
                                    {record.care}
                                  </span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Modal Footer */}
                      <div className="flex gap-2.5 justify-end mt-2 pt-4 border-t border-border/50">
                        <button
                          onClick={() => {
                            if ("speechSynthesis" in window) {
                              window.speechSynthesis.cancel();
                              const utterance = new SpeechSynthesisUtterance(getResSearchAISummary(researchTerm, filteredRecords));
                              utterance.rate = 1.0;
                              utterance.pitch = 1.0;
                              window.speechSynthesis.speak(utterance);
                            }
                          }}
                          className="px-3.5 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                        >
                          <Mic className="w-3.5 h-3.5" /> Speak Summary
                        </button>
                        <button
                          onClick={() => setShowResSearchModal(false)}
                          className="px-4 py-2 rounded-xl bg-foreground text-background text-xs font-bold hover:scale-[1.01] transition-all cursor-pointer"
                        >
                          Close
                        </button>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
            </div>
          );
        }

        default:
          return null;
      }
    }

    // -------------------------------------------------------------
    // SUPER ADMIN TABS
    // -------------------------------------------------------------
    if (activeRole === "SUPERADMIN") {
      switch (activeTab) {
        case "Admin Dashboard":
          return renderUnifiedDashboard();

        case "Staff Registry":
          return (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch w-full">
              {/* Form to Register Staff */}
              <div className="glass-panel p-6 rounded-2xl text-left border-white/5 light:border-black/5 shadow-md bg-background/50 lg:col-span-1 flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-1.5">
                    <Plus className="w-5 h-5 text-amber-500" /> Add New Staff
                  </h3>
                  <p className="text-xs text-muted-foreground font-light mt-0.5">Register licensed nurse or caregiver profile.</p>
                </div>
                <hr className="border-border/50 my-4" />
                <form onSubmit={handleRegisterStaff} className="space-y-4 flex-1">
                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={newStaff.name}
                      onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
                      placeholder="e.g. Elena Rostova"
                      className="w-full px-3 py-2 text-xs rounded-xl bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Role Assignment</label>
                    <select
                      value={newStaff.role}
                      onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                    >
                      <option value="Head Nurse">Head Nurse</option>
                      <option value="Caregiver Specialist">Caregiver Specialist</option>
                      <option value="Nursing Assistant">Nursing Assistant</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={newStaff.email}
                      onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                      placeholder="e.g. e.rostova@goldenhearth.org"
                      className="w-full px-3 py-2 text-xs rounded-xl bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Assigned Rooms</label>
                    <input
                      type="text"
                      value={newStaff.rooms}
                      onChange={(e) => setNewStaff({ ...newStaff, rooms: e.target.value })}
                      placeholder="e.g. 09C - 15A"
                      className="w-full px-3 py-2 text-xs rounded-xl bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-3 rounded-xl bg-foreground text-background font-bold text-xs hover:scale-[1.01] transition-transform cursor-pointer"
                  >
                    Add Registry Profile
                  </button>
                </form>
              </div>

              {/* Staff Registry List */}
              <div className="glass-panel p-6 rounded-2xl text-left border-white/5 light:border-black/5 shadow-md bg-background/50 lg:col-span-2">
                <h3 className="text-lg font-bold tracking-tight text-foreground mb-4">Active Staff Directory</h3>
                
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {staffList.map((staff) => (
                    <div key={staff.id} className="p-4 rounded-xl bg-foreground/5 border border-border flex items-center justify-between gap-4">
                      <div>
                        <h4 className="text-xs font-bold text-foreground">{staff.name}</h4>
                        <p className="text-[10px] text-muted-foreground font-light mt-0.5">{staff.email}</p>
                        <p className="text-[10px] text-muted-foreground font-light mt-2">
                          Assigned Rooms: <span className="font-semibold text-foreground">{staff.rooms}</span>
                        </p>
                      </div>
                      <span className="text-[9px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2.5 py-1 rounded">
                        {staff.role}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );

        case "System Telemetry":
          return (
            <div className="glass-panel p-6 rounded-2xl text-left border-white/5 light:border-black/5 shadow-md bg-background/50 w-full">
              <h3 className="text-lg font-bold tracking-tight text-foreground mb-1 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-amber-500" /> GPU Edge Node Activity
              </h3>
              <p className="text-xs text-muted-foreground font-light mb-6">Real-time telemetry frames processing stats.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-4 rounded-xl bg-foreground/5 border border-border">
                  <h4 className="text-xs font-bold text-foreground mb-4 uppercase tracking-wider">Frame Latency Trend</h4>
                  
                  {/* CSS Graph */}
                  <div className="flex items-end justify-between h-28 pt-4 px-2 border-b border-border/50">
                    <div className="w-6 bg-green-500/20 h-[10%] rounded-t relative group"><span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold hidden group-hover:block">12ms</span></div>
                    <div className="w-6 bg-green-500/30 h-[15%] rounded-t relative group"><span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold hidden group-hover:block">15ms</span></div>
                    <div className="w-6 bg-green-500/40 h-[11%] rounded-t relative group"><span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold hidden group-hover:block">11ms</span></div>
                    <div className="w-6 bg-amber-500/50 h-[35%] rounded-t relative group"><span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold text-amber-500 hidden group-hover:block">32ms</span></div>
                    <div className="w-6 bg-green-500/40 h-[12%] rounded-t relative group"><span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold hidden group-hover:block">12ms</span></div>
                    <div className="w-6 bg-green-500/30 h-[9%] rounded-t relative group"><span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold hidden group-hover:block">9ms</span></div>
                  </div>
                  <div className="flex justify-between text-[8px] font-bold text-muted-foreground tracking-wider uppercase mt-2 px-1">
                    <span>11:00</span>
                    <span>11:10</span>
                    <span>11:20</span>
                    <span>11:30</span>
                    <span>11:40</span>
                    <span>11:50</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-foreground/5 border border-border">
                  <h4 className="text-xs font-bold text-foreground mb-4 uppercase tracking-wider">Telemetry Memory Allocation</h4>
                  <div className="space-y-4 mt-2">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Neural Net Cache</span>
                        <span className="font-semibold">78%</span>
                      </div>
                      <div className="w-full bg-foreground/10 h-2 rounded-full overflow-hidden">
                        <div className="bg-amber-500 h-full rounded-full" style={{ width: "78%" }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Video Buffer Uptime</span>
                        <span className="font-semibold">42%</span>
                      </div>
                      <div className="w-full bg-foreground/10 h-2 rounded-full overflow-hidden">
                        <div className="bg-amber-500 h-full rounded-full" style={{ width: "42%" }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Record Sync Buffer</span>
                        <span className="font-semibold">12%</span>
                      </div>
                      <div className="w-full bg-foreground/10 h-2 rounded-full overflow-hidden">
                        <div className="bg-amber-500 h-full rounded-full" style={{ width: "12%" }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );

        case "Platform Settings":
          return (
            <div className="glass-panel p-6 rounded-2xl text-left border-white/5 light:border-black/5 shadow-md bg-background/50 w-full">
              <h3 className="text-lg font-bold tracking-tight text-foreground mb-1 flex items-center gap-1.5">
                <Settings className="w-5 h-5 text-amber-500" /> Platform Configurations
              </h3>
              <p className="text-xs text-muted-foreground font-light mb-6">Modify platform behavior and security configurations.</p>

              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-foreground/5 border border-border flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-foreground">Optical Matrix Fall Alerts</h4>
                    <p className="text-[10px] text-muted-foreground font-light mt-0.5">Toggle computer vision fall detection pipeline.</p>
                  </div>
                  <button
                    onClick={() => setSettings({ ...settings, opticalMatrix: !settings.opticalMatrix })}
                    className={`w-10 h-6 rounded-full p-1 transition-all cursor-pointer ${settings.opticalMatrix ? "bg-amber-500 flex justify-end" : "bg-zinc-700 flex justify-start"}`}
                  >
                    <span className="w-4 h-4 rounded-full bg-black shadow" />
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-foreground/5 border border-border flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-foreground">Voice AI Charting (NLP)</h4>
                    <p className="text-[10px] text-muted-foreground font-light mt-0.5">Allow clinical nurses to use microphone voice logging.</p>
                  </div>
                  <button
                    onClick={() => setSettings({ ...settings, voiceNLP: !settings.voiceNLP })}
                    className={`w-10 h-6 rounded-full p-1 transition-all cursor-pointer ${settings.voiceNLP ? "bg-amber-500 flex justify-end" : "bg-zinc-700 flex justify-start"}`}
                  >
                    <span className="w-4 h-4 rounded-full bg-black shadow" />
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-foreground/5 border border-border flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-foreground">HIPAA Logs Encryption</h4>
                    <p className="text-[10px] text-muted-foreground font-light mt-0.5">Encrypt all stored resident logs with 256-bit AES.</p>
                  </div>
                  <button
                    onClick={() => setSettings({ ...settings, hipaaLock: !settings.hipaaLock })}
                    className={`w-10 h-6 rounded-full p-1 transition-all cursor-pointer ${settings.hipaaLock ? "bg-amber-500 flex justify-end" : "bg-zinc-700 flex justify-start"}`}
                  >
                    <span className="w-4 h-4 rounded-full bg-black shadow" />
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-foreground/5 border border-border flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-foreground flex items-center gap-1">
                      Developer Testing Mode <Info className="w-3.5 h-3.5 text-zinc-500" />
                    </h4>
                    <p className="text-[10px] text-muted-foreground font-light mt-0.5">Toggle mock data streams and simulation warnings.</p>
                  </div>
                  <button
                    onClick={() => setSettings({ ...settings, testMode: !settings.testMode })}
                    className={`w-10 h-6 rounded-full p-1 transition-all cursor-pointer ${settings.testMode ? "bg-amber-500 flex justify-end" : "bg-zinc-700 flex justify-start"}`}
                  >
                    <span className="w-4 h-4 rounded-full bg-black shadow" />
                  </button>
                </div>
              </div>
            </div>
          );

        default:
          return null;
      }
    }

    // -------------------------------------------------------------
    // CAREGIVER TABS
    // -------------------------------------------------------------
    if (activeRole === "CAREGIVER") {
      switch (activeTab) {
        case "Shift Dashboard":
          return renderUnifiedDashboard();

        case "Task Checklist":
          return (
            <div className="space-y-6 w-full max-w-7xl">
              {/* TOP ROW: Safety & Communication Systems */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <EmergencyCallSystem
                  callBells={callBells}
                  onAcknowledge={(id) => {
                    setCallBells(callBells.map(c => c.id === id ? { ...c, status: "acknowledged" } : c));
                  }}
                />
                <IncidentQuickReport
                  showForm={showIncidentForm}
                  onShowForm={setShowIncidentForm}
                  newIncident={newIncident}
                  onIncidentChange={(field, value) => setNewIncident({ ...newIncident, [field]: value })}
                  onSubmit={() => {
                    if (newIncident.resident && newIncident.notes) {
                      setCaregiverIncidents([...caregiverIncidents, { ...newIncident, id: Date.now(), time: new Date().toLocaleTimeString(), reported: true }]);
                      setNewIncident({ type: "Fall", severity: "normal", room: "", resident: "", notes: "" });
                      setShowIncidentForm(false);
                    }
                  }}
                />
              </div>

              {/* MIDDLE ROW: Task Management & Communication */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Task Checklist */}
                <div className="lg:col-span-2 glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50">
                  <div className="flex justify-between items-center mb-6">
                    <div>
                      <h3 className="text-lg font-bold tracking-tight text-foreground">Shift Task Checklist</h3>
                      <p className="text-xs text-muted-foreground font-light mt-0.5">Smart task management with filters & tracking.</p>
                    </div>
                    <span className="text-[10px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded-full">
                      {tasks.filter(t => t.done).length}/{tasks.length} Completed
                    </span>
                  </div>

                  {/* Task Filters */}
                  <div className="flex gap-2 mb-4">
                    {["all", "pending", "completed"].map(f => (
                      <button
                        key={f}
                        onClick={() => setTaskFilter(f as any)}
                        className={`px-3 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                          taskFilter === f
                            ? "bg-amber-500 text-background border-amber-500"
                            : "bg-foreground/5 text-foreground border-border hover:border-amber-500"
                        }`}
                      >
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-3">
                    {tasks.filter(t => taskFilter === "all" || (taskFilter === "pending" && !t.done) || (taskFilter === "completed" && t.done)).map(t => (
                      <button
                        key={t.id}
                        onClick={() => toggleTask(t.id)}
                        className={`w-full text-left p-4 rounded-xl border flex items-center justify-between gap-3 transition-colors cursor-pointer ${t.done ? "bg-amber-500/5 border-amber-500/10 text-muted-foreground line-through" : "bg-foreground/5 border-border text-foreground hover:bg-foreground/10"}`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`w-3 h-3 rounded-full shrink-0 ${t.done ? "bg-amber-500" : "bg-zinc-600"}`} />
                          <div>
                            <p className="text-xs font-semibold">{t.task}</p>
                            <p className="text-[10px] opacity-75 mt-0.5">Room {t.room}</p>
                          </div>
                        </div>
                        <CheckCircle className={`w-4 h-4 shrink-0 transition-transform ${t.done ? "text-amber-500 scale-110" : "text-zinc-600"}`} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Progress & Time Tracking */}
                <div className="space-y-6">
                  <div className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50">
                    <h3 className="text-sm font-bold text-foreground mb-4">Progress</h3>
                    <div className="p-4 rounded-xl bg-foreground/5 border border-border">
                      <p className="text-xs text-muted-foreground">Completion</p>
                      <h4 className="text-2xl font-extrabold text-foreground mt-1">
                        {Math.round((tasks.filter(t => t.done).length / tasks.length) * 100)}%
                      </h4>
                      <div className="w-full bg-foreground/10 h-1.5 rounded-full overflow-hidden mt-3">
                        <div className="bg-amber-500 h-full rounded-full" style={{ width: `${(tasks.filter(t => t.done).length / tasks.length) * 100}%` }} />
                      </div>
                    </div>
                  </div>

                  <TimeTracking
                    shiftTime={shiftTime}
                    onClockToggle={() => {
                      setShiftTime({ ...shiftTime, status: shiftTime.status === "clocked-in" ? "clocked-out" : "clocked-in" });
                    }}
                    onBreakToggle={() => {
                      if (!shiftTime.breakStart) {
                        setShiftTime({ ...shiftTime, breakStart: new Date().toLocaleTimeString() });
                      } else {
                        setShiftTime({ ...shiftTime, breakStart: null, breakEnd: new Date().toLocaleTimeString() });
                      }
                    }}
                  />
                </div>
              </div>

              {/* BOTTOM ROW: Vitals, Messaging & Resident Notes */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <VitalsQuickLog
                  vitalsLog={vitalsLog}
                  showVitalsForm={showVitalsForm}
                  onShowForm={setShowVitalsForm}
                  newVitals={newVitals}
                  onVitalsChange={(field, value) => setNewVitals({ ...newVitals, [field]: value })}
                  onSubmit={() => {
                    if (newVitals.resident) {
                      setVitalsLog([...vitalsLog, { ...newVitals, id: Date.now(), time: new Date().toLocaleTimeString() }]);
                      setNewVitals({ resident: "", bp: "", temp: "", o2: "" });
                      setShowVitalsForm(false);
                    }
                  }}
                />

                <QuickMessaging
                  messages={messages}
                  showMessaging={showMessaging}
                  onShowMessaging={setShowMessaging}
                  newMessage={newMessage}
                  onMessageChange={setNewMessage}
                  onSendMessage={() => {
                    if (newMessage.trim()) {
                      setMessages([...messages, { id: Date.now(), from: "Caleb R.", to: messageRecipient, text: newMessage, timestamp: new Date().toLocaleTimeString(), status: "pending" }]);
                      setNewMessage("");
                      setShowMessaging(false);
                    }
                  }}
                />

                {/* Resident Notes */}
                <div className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50">
                  <h3 className="text-lg font-bold text-foreground mb-4">Resident Notes</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {residentNotes.map(note => (
                      <div key={note.id} className={`p-3 rounded-lg border text-[9px] ${
                        note.read ? "bg-foreground/5 border-border" : "bg-blue-500/10 border-blue-500/20"
                      }`}>
                        <p className="font-semibold text-foreground">{note.resident}</p>
                        <p className="text-muted-foreground mt-1">{note.note}</p>
                        <p className="text-[8px] text-muted-foreground mt-1">{note.caregiver}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );

        case "Resident Status": {
          const residentStatusData = [
            { name: "Arthur Pendelton", room: "12A", status: "Active", lastMeal: "12:30", medications: "On Schedule", lastCheck: "14:45", mood: "Good", notes: "Slightly favoring left leg" },
            { name: "Eleanor Vance", room: "08B", status: "Rest", lastMeal: "12:15", medications: "On Schedule", lastCheck: "14:30", mood: "Fair", notes: "Monitor appetite" },
            { name: "Gerald Cooper", room: "03A", status: "Activity", lastMeal: "12:45", medications: "On Schedule", lastCheck: "14:20", mood: "Excellent", notes: "Enjoying garden time" },
            { name: "Harriet Finch", room: "11C", status: "Rest", lastMeal: "12:00", medications: "Due 18:00", lastCheck: "13:50", mood: "Good", notes: "Memory care - consistent routine" },
          ];

          return (
            <div className="space-y-6 w-full max-w-7xl">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {residentStatusData.map((res, idx) => (
                  <div key={`status-${idx}`} className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-base font-bold text-foreground">{res.name}</h3>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Room {res.room}</p>
                      </div>
                      <span className={`text-[9px] font-bold px-2 py-1 rounded border ${
                        res.status === "Active" ? "bg-green-500/10 text-green-500 border-green-500/20" :
                        res.status === "Rest" ? "bg-blue-500/10 text-blue-500 border-blue-500/20" :
                        "bg-amber-500/10 text-amber-500 border-amber-500/20"
                      }`}>
                        {res.status}
                      </span>
                    </div>

                    <div className="space-y-3 text-[10px]">
                      <div className="flex justify-between pb-2 border-b border-border/20">
                        <span className="text-muted-foreground">Last Meal</span>
                        <span className="text-foreground font-semibold">{res.lastMeal}</span>
                      </div>
                      <div className="flex justify-between pb-2 border-b border-border/20">
                        <span className="text-muted-foreground">Medications</span>
                        <span className={`font-semibold ${res.medications === "On Schedule" ? "text-green-500" : "text-orange-500"}`}>
                          {res.medications}
                        </span>
                      </div>
                      <div className="flex justify-between pb-2 border-b border-border/20">
                        <span className="text-muted-foreground">Last Check</span>
                        <span className="text-foreground font-semibold">{res.lastCheck}</span>
                      </div>
                      <div className="flex justify-between pb-2 border-b border-border/20">
                        <span className="text-muted-foreground">Mood</span>
                        <span className="text-foreground font-semibold">{res.mood}</span>
                      </div>
                      <div className="pt-2">
                        <p className="text-muted-foreground mb-1">Care Notes</p>
                        <p className="text-foreground italic">{res.notes}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Interaction Log */}
              <div className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50">
                <h3 className="text-lg font-bold text-foreground mb-4">Today's Interaction Log</h3>
                <div className="space-y-2">
                  {interactionLog.map(log => (
                    <div key={log.id} className="p-3 rounded-lg bg-foreground/5 border border-border flex justify-between items-center">
                      <div>
                        <p className="text-xs font-semibold text-foreground">{log.resident}</p>
                        <p className="text-[9px] text-muted-foreground">{log.activity}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-bold">{log.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        }

        case "Shift Reports":
          return (
            <div className="space-y-6 w-full max-w-7xl">
              {/* TOP ROW: Daily Summary & Performance */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Daily Shift Summary */}
                <div className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50">
                  <h3 className="text-lg font-bold text-foreground mb-4">Daily Shift Summary</h3>
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-foreground/5 border border-border">
                      <p className="text-[9px] text-muted-foreground uppercase font-bold">Tasks Completed</p>
                      <p className="text-xl font-bold text-amber-500 mt-1">{shiftSummary.tasksCompleted}/{shiftSummary.tasksTotal}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-foreground/5 border border-border">
                      <p className="text-[9px] text-muted-foreground uppercase font-bold">Incidents Reported</p>
                      <p className="text-xl font-bold text-orange-500 mt-1">{shiftSummary.incidentsReported}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-foreground/5 border border-border">
                      <p className="text-[9px] text-muted-foreground uppercase font-bold">Calls Responded</p>
                      <p className="text-xl font-bold text-blue-500 mt-1">{shiftSummary.callBellsResponded}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-foreground/5 border border-border">
                      <p className="text-[9px] text-muted-foreground uppercase font-bold">Avg Response Time</p>
                      <p className="text-xl font-bold text-green-500 mt-1">{shiftSummary.avgResponseTime}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-foreground/5 border border-border">
                      <p className="text-[9px] text-muted-foreground uppercase font-bold">Resident Engagement</p>
                      <p className="text-xl font-bold text-purple-500 mt-1">{shiftSummary.residentEngagement}%</p>
                    </div>
                  </div>
                </div>

                {/* Performance Metrics */}
                <div className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50">
                  <h3 className="text-lg font-bold text-foreground mb-4">Performance Dashboard</h3>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] font-bold text-muted-foreground">Task Completion</span>
                        <span className="text-[10px] font-bold text-foreground">{performanceMetrics.taskCompletion}%</span>
                      </div>
                      <div className="w-full bg-foreground/10 h-2 rounded-full overflow-hidden">
                        <div className="bg-green-500 h-full" style={{ width: `${performanceMetrics.taskCompletion}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] font-bold text-muted-foreground">Quality Score</span>
                        <span className="text-[10px] font-bold text-foreground">{performanceMetrics.qualityScore}%</span>
                      </div>
                      <div className="w-full bg-foreground/10 h-2 rounded-full overflow-hidden">
                        <div className="bg-blue-500 h-full" style={{ width: `${performanceMetrics.qualityScore}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] font-bold text-muted-foreground">Safety Incidents</span>
                        <span className={`text-[10px] font-bold ${performanceMetrics.safetyIncidents === 0 ? "text-green-500" : "text-red-500"}`}>
                          {performanceMetrics.safetyIncidents}
                        </span>
                      </div>
                      <div className="w-full bg-foreground/10 h-2 rounded-full overflow-hidden">
                        <div className={`h-full ${performanceMetrics.safetyIncidents === 0 ? "bg-green-500" : "bg-red-500"}`} style={{ width: `${Math.min(performanceMetrics.safetyIncidents * 20, 100)}%` }} />
                      </div>
                    </div>

                    {/* Trend */}
                    <div className="pt-2 border-t border-border/20">
                      <p className="text-[10px] font-bold text-muted-foreground mb-2">Monthly Trend</p>
                      <div className="flex items-end gap-1 h-16">
                        {performanceMetrics.monthlyTrend.map((val, i) => (
                          <div key={i} className="flex-1 bg-amber-500/20 rounded-t border border-amber-500/30 hover:bg-amber-500/30 transition-all" style={{ height: `${val}%` }} title={`${val}%`} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* MIDDLE ROW: Handoff Briefing & Medication Log */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Handoff Briefing */}
                <div className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50">
                  <h3 className="text-lg font-bold text-foreground mb-4">Shift Handoff Briefing</h3>
                  <div className="space-y-4">
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground mb-2">KEY ALERTS</p>
                      <div className="space-y-1">
                        {handoffBriefing.keyAlerts.map((alert, i) => (
                          <div key={i} className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[9px] text-foreground">
                            ⚠️ {alert}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground mb-2">OUTSTANDING TASKS</p>
                      <div className="space-y-1">
                        {handoffBriefing.outstandingTasks.map((task, i) => (
                          <div key={i} className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-[9px] text-foreground">
                            📋 {task}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-border/20">
                      <p className="text-[10px] font-bold text-muted-foreground mb-2">SPECIAL NOTES</p>
                      <p className="text-[9px] text-foreground italic">{handoffBriefing.specialNotes}</p>
                    </div>
                  </div>
                </div>

                {/* Medication Verification */}
                <div className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50">
                  <h3 className="text-lg font-bold text-foreground mb-4">Medication Log</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {medicationLog.map(med => (
                      <div key={med.id} className={`p-3 rounded-lg border text-[9px] ${
                        med.verified
                          ? "bg-green-500/10 border-green-500/20"
                          : "bg-orange-500/10 border-orange-500/20"
                      }`}>
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-semibold text-foreground">{med.resident}</p>
                            <p className="text-muted-foreground">{med.medication}</p>
                          </div>
                          <span className={`text-[8px] font-bold px-2 py-1 rounded ${
                            med.verified ? "bg-green-500/20 text-green-400" : "bg-orange-500/20 text-orange-400"
                          }`}>
                            {med.verified ? "✓ Verified" : "Pending"}
                          </span>
                        </div>
                        <div className="flex justify-between mt-1 text-[8px] text-muted-foreground">
                          <span>{med.time}</span>
                          <span>{med.signature || "Not signed"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* BOTTOM ROW: Shift Notes */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Write Shift Log Form */}
                <div className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50 lg:col-span-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-1">
                      <Plus className="w-5 h-5 text-amber-500" /> Log Note
                    </h3>
                    <p className="text-xs text-muted-foreground font-light mt-0.5">Document shift activities.</p>
                  </div>
                  <hr className="border-border/50 my-4" />
                  <form onSubmit={handleAddShiftReport} className="space-y-4 flex-1">
                    <textarea
                      required
                      value={newReport}
                      onChange={(e) => setNewReport(e.target.value)}
                      placeholder="Room checks, resident interactions, special events..."
                      className="w-full px-3 py-2 text-xs rounded-xl bg-foreground/5 border border-border focus:outline-none focus:border-amber-500 min-h-[120px] resize-none"
                    />
                    <button
                      type="submit"
                      className="w-full py-3 rounded-xl bg-foreground text-background font-bold text-xs hover:scale-[1.01] transition-transform cursor-pointer"
                    >
                      Save Note
                    </button>
                  </form>
                </div>

                {/* Shift Logs Feed */}
                <div className="glass-panel p-6 rounded-2xl text-left border-white/5 shadow-md bg-background/50 lg:col-span-2">
                  <h3 className="text-lg font-bold tracking-tight text-foreground mb-4">Shift Timeline</h3>

                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                    {caregiverNotes.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground font-light italic text-xs border border-dashed border-border rounded-xl bg-foreground/2">
                        No notes yet. Add your first note on the left.
                      </div>
                    ) : (
                      caregiverNotes.map((note, idx) => (
                        <div key={`note-${idx}-${note.slice(0, 10)}`} className="p-3.5 rounded-xl bg-foreground/5 border border-border flex flex-col gap-2">
                          <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                            <span className="font-semibold text-foreground">Caleb Randall</span>
                            <span>Just now</span>
                          </div>
                          <p className="text-xs text-foreground/80 leading-relaxed font-light">{note}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          );

        default:
          return null;
      }
    }

    // -------------------------------------------------------------
    // FAMILY SPONSOR TABS
    // -------------------------------------------------------------
    if (activeRole === "FAMILY") {
      switch (activeTab) {
        case "Family Dashboard":
          return (
            <div className="space-y-6 w-full max-w-7xl">
              {/* 4 COUNT CARDS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
                {/* Card 1: Vitals Status */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0 }}
                  className="glass-panel p-6 rounded-2xl border border-white/5 bg-background/50 hover:scale-[1.02] transition-transform"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Vitals Status</span>
                    <Activity className="w-5 h-5 text-green-500" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-foreground">Stable</h3>
                  <p className="text-[10px] text-muted-foreground mt-1">Heart Rate: 72 bpm</p>
                  <div className="mt-3 pt-3 border-t border-border/50 text-[9px] text-green-500 font-semibold">
                    ✓ All readings normal
                  </div>
                </motion.div>

                {/* Card 2: Activities Today */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="glass-panel p-6 rounded-2xl border border-white/5 bg-background/50 hover:scale-[1.02] transition-transform"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Activities</span>
                    <Users className="w-5 h-5 text-blue-500" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-foreground">4</h3>
                  <p className="text-[10px] text-muted-foreground mt-1">Completed today</p>
                  <div className="mt-3 pt-3 border-t border-border/50 text-[9px] text-blue-500 font-semibold">
                    Garden walk • Meal time • Rest
                  </div>
                </motion.div>

                {/* Card 3: Medication Compliance */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="glass-panel p-6 rounded-2xl border border-white/5 bg-background/50 hover:scale-[1.02] transition-transform"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Medications</span>
                    <CheckCircle className="w-5 h-5 text-amber-500" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-foreground">100%</h3>
                  <p className="text-[10px] text-muted-foreground mt-1">This week</p>
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <div className="w-full bg-foreground/10 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-amber-500 h-full rounded-full" style={{ width: "100%" }} />
                    </div>
                  </div>
                </motion.div>

                {/* Card 4: Next Visit */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="glass-panel p-6 rounded-2xl border border-white/5 bg-background/50 hover:scale-[1.02] transition-transform"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Next Visit</span>
                    <Clock className="w-5 h-5 text-purple-500" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-foreground">Saturday</h3>
                  <p className="text-[10px] text-muted-foreground mt-1">2:00 PM</p>
                  <div className="mt-3 pt-3 border-t border-border/50 text-[9px] text-purple-500 font-semibold">
                    Lounge room • 2 hours
                  </div>
                </motion.div>
              </div>

              {/* 3 ANALYTICS CHARTS */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
                {/* Chart 1: Heart Rate Trend (Area Chart) */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="glass-panel p-6 rounded-2xl border border-white/5 bg-background/50 flex flex-col"
                >
                  <div className="mb-4">
                    <h3 className="text-base font-bold text-foreground">Arthur's Heart Rate Trend</h3>
                    <p className="text-[10px] text-muted-foreground mt-1">24-hour monitoring</p>
                  </div>

                  <div className="relative h-48 w-full">
                    <svg className="w-full h-full text-green-500" viewBox="0 0 100 30" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="heartGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
                          <stop offset="100%" stopColor="currentColor" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                      <path d="M0,22 L20,18 L40,20 L60,16 L80,19 L100,17 L100,30 L0,30 Z" fill="url(#heartGrad)" />
                      <path d="M0,22 L20,18 L40,20 L60,16 L80,19 L100,17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>

                    {/* Data Points */}
                    {[
                      { left: "0%", top: "26.7%", val: "72 bpm", time: "12:00 AM" },
                      { left: "20%", top: "40%", val: "68 bpm", time: "06:00 AM" },
                      { left: "40%", top: "33.3%", val: "70 bpm", time: "12:00 PM" },
                      { left: "60%", top: "46.7%", val: "75 bpm", time: "06:00 PM" },
                      { left: "80%", top: "36.7%", val: "72 bpm", time: "11:00 PM" },
                      { left: "100%", top: "43.3%", val: "70 bpm", time: "Now" },
                    ].map((pt, i) => (
                      <div key={i} className="absolute group z-10" style={{ left: pt.left, top: pt.top, transform: "translate(-50%, -50%)" }}>
                        <div className="w-2 h-2 rounded-full bg-green-500 border border-zinc-950 shadow-md group-hover:scale-125 transition-transform" />
                        <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col bg-zinc-950/95 border border-white/10 rounded px-2 py-1 text-[8px] text-foreground shadow-lg whitespace-nowrap">
                          <span className="font-semibold text-green-500">{pt.time}</span>
                          <span className="font-bold mt-0.5">{pt.val}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between text-[8px] font-bold text-muted-foreground mt-4 px-1">
                    <span>12 AM</span>
                    <span>6 AM</span>
                    <span>12 PM</span>
                    <span>6 PM</span>
                    <span>Now</span>
                  </div>
                </motion.div>

                {/* Chart 2: Activity Log (Column Chart) */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="glass-panel p-6 rounded-2xl border border-white/5 bg-background/50 flex flex-col"
                >
                  <div className="mb-4">
                    <h3 className="text-base font-bold text-foreground">Weekly Activity</h3>
                    <p className="text-[10px] text-muted-foreground mt-1">Hours active per day</p>
                  </div>

                  <div className="flex justify-between items-end h-40 pt-4 px-2 border-b border-border/20">
                    {[
                      { day: "Mon", val: 6 },
                      { day: "Tue", val: 7 },
                      { day: "Wed", val: 5 },
                      { day: "Thu", val: 8 },
                      { day: "Fri", val: 6 },
                      { day: "Sat", val: 9 },
                      { day: "Sun", val: 7 },
                    ].map((d, i) => (
                      <div key={i} className="group relative flex flex-col items-center gap-1 w-6">
                        <div
                          className="w-full rounded-t bg-blue-500 group-hover:bg-blue-400 transition-all"
                          style={{ height: `${d.val * 4}px` }}
                        />
                        <span className="text-[8px] text-muted-foreground font-bold">{d.day}</span>
                        <div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-zinc-950 border border-white/10 rounded px-2 py-1 text-[8px] text-foreground shadow-lg whitespace-nowrap">
                          {d.val} hours
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>

                {/* Chart 3: Mood & Comfort (Bar Chart) */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="glass-panel p-6 rounded-2xl border border-white/5 bg-background/50 flex flex-col"
                >
                  <div className="mb-4">
                    <h3 className="text-base font-bold text-foreground">Comfort & Engagement Score</h3>
                    <p className="text-[10px] text-muted-foreground mt-1">Weekly assessment</p>
                  </div>

                  <div className="space-y-4 flex-1">
                    {[
                      { label: "Mood", val: 85, color: "bg-amber-500" },
                      { label: "Pain Level", val: 15, color: "bg-red-500" },
                      { label: "Sleep Quality", val: 80, color: "bg-purple-500" },
                      { label: "Social Engagement", val: 75, color: "bg-blue-500" },
                    ].map((metric, i) => (
                      <div key={i}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold text-muted-foreground">{metric.label}</span>
                          <span className="text-[10px] font-bold text-foreground">{metric.val}%</span>
                        </div>
                        <div className="w-full bg-foreground/10 h-2 rounded-full overflow-hidden">
                          <div className={`${metric.color} h-full rounded-full transition-all`} style={{ width: `${metric.val}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </div>

              {/* 2 ADDITIONAL CHARTS */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
                {/* Chart 4: Sleep Quality Trend */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.7 }}
                  className="glass-panel p-6 rounded-2xl border border-white/5 bg-background/50 flex flex-col"
                >
                  <div className="mb-4">
                    <h3 className="text-base font-bold text-foreground">Sleep Quality Trend</h3>
                    <p className="text-[10px] text-muted-foreground mt-1">Hours slept & quality rating</p>
                  </div>

                  <div className="space-y-4 flex-1">
                    {[
                      { day: "Monday", hours: 7.5, quality: 85 },
                      { day: "Tuesday", hours: 8, quality: 88 },
                      { day: "Wednesday", hours: 6.5, quality: 72 },
                      { day: "Thursday", hours: 8.5, quality: 90 },
                      { day: "Friday", hours: 7, quality: 80 },
                      { day: "Saturday", hours: 9, quality: 92 },
                      { day: "Sunday", hours: 8, quality: 87 },
                    ].map((item, i) => (
                      <div key={i} className="group">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold text-muted-foreground">{item.day}</span>
                          <span className="text-[10px] font-bold text-foreground">{item.hours}h</span>
                        </div>
                        <div className="relative w-full bg-foreground/10 h-2 rounded-full overflow-hidden">
                          <div className="bg-purple-500 h-full rounded-full" style={{ width: `${(item.hours / 10) * 100}%` }} />
                          <div className="absolute top-0 left-0 w-full h-full flex items-center">
                            <div className="text-[8px] text-purple-300 font-bold ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              Quality: {item.quality}%
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>

                {/* Chart 5: Daily Meals & Nutrition */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8 }}
                  className="glass-panel p-6 rounded-2xl border border-white/5 bg-background/50 flex flex-col"
                >
                  <div className="mb-4">
                    <h3 className="text-base font-bold text-foreground">Daily Nutrition</h3>
                    <p className="text-[10px] text-muted-foreground mt-1">Meals consumed today</p>
                  </div>

                  <div className="space-y-4 flex-1">
                    {[
                      { meal: "Breakfast", consumed: 95, icon: "🍳" },
                      { meal: "Mid-Morning Snack", consumed: 80, icon: "🍎" },
                      { meal: "Lunch", consumed: 100, icon: "🍽️" },
                      { meal: "Afternoon Snack", consumed: 70, icon: "🥤" },
                      { meal: "Dinner", consumed: 90, icon: "🍲" },
                      { meal: "Hydration", consumed: 85, icon: "💧" },
                    ].map((item, i) => (
                      <div key={i} className="group">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold text-muted-foreground">
                            {item.icon} {item.meal}
                          </span>
                          <span className="text-[10px] font-bold text-foreground">{item.consumed}%</span>
                        </div>
                        <div className="w-full bg-foreground/10 h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              item.consumed >= 90
                                ? "bg-green-500"
                                : item.consumed >= 70
                                ? "bg-amber-500"
                                : "bg-red-500"
                            }`}
                            style={{ width: `${item.consumed}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </div>
            </div>
          );

        case "My Relative":
          return (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch w-full">
              {/* Resident Card */}
              <div className="glass-panel p-6 rounded-2xl text-left border-white/5 light:border-black/5 shadow-md bg-background/50 lg:col-span-1 flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-bold tracking-tight text-foreground mb-4">Relative Profile</h3>
                  
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-foreground/5 border border-border">
                    <span className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center font-bold text-amber-500 text-sm">
                      AP
                    </span>
                    <div>
                      <p className="text-sm font-bold text-foreground">Arthur Pendelton</p>
                      <p className="text-[10px] text-muted-foreground">Room 12A • Wing A Suite</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 mt-6">
                  <div>
                    <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Care Tier</span>
                    <p className="text-xs font-semibold text-foreground mt-0.5">Assisted Care Tier</p>
                  </div>
                  <div>
                    <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Facility Address</span>
                    <p className="text-xs font-semibold text-foreground mt-0.5">Wing A, Suite 12A, Golden Hearth Facility</p>
                  </div>
                  <div>
                    <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Relationship</span>
                    <p className="text-xs font-semibold text-foreground mt-0.5">Father (Primary Sponsor)</p>
                  </div>
                </div>
              </div>

              {/* Comfort Status Summary */}
              <div className="glass-panel p-6 rounded-2xl text-left border-white/5 light:border-black/5 shadow-md bg-background/50 lg:col-span-2">
                <h3 className="text-lg font-bold tracking-tight text-foreground mb-2">Daily Comfort Summary</h3>
                <p className="text-xs text-muted-foreground font-light mb-6">Generated daily comfort synthesis from clinical nurse logs.</p>
                
                <div className="p-5 rounded-xl border border-amber-500/10 bg-amber-500/5 leading-relaxed text-xs text-foreground/80 font-light space-y-4">
                  <p>
                    <strong>Morning Status:</strong> Arthur was active and completed his daily garden stroll with Caregiver Caleb Randall. Heart rate and blood pressure remain stable within parameters.
                  </p>
                  <p>
                    <strong>Afternoon Status:</strong> Participated in the community recreation room physical therapy session. Enjoys social interactions.
                  </p>
                  <p>
                    <strong>Evening Status:</strong> Dinner was fully consumed. Rest period started. Suite 12A Optical Matrix shows posture status: <em>Normal resting/sitting</em>.
                  </p>
                </div>
              </div>
            </div>
          );

        case "Health Timeline":
          return (
            <div className="glass-panel p-6 rounded-2xl text-left border-white/5 light:border-black/5 shadow-md bg-background/50 w-full">
              <h3 className="text-lg font-bold tracking-tight text-foreground mb-1 flex items-center gap-1.5">
                <Activity className="w-5 h-5 text-amber-500" /> Vitals History
              </h3>
              <p className="text-xs text-muted-foreground font-light mb-6">Historical records synced dynamically.</p>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="p-4 rounded-xl bg-foreground/5 border border-border lg:col-span-2">
                  <h4 className="text-xs font-bold text-foreground mb-4 uppercase tracking-wider">Vitals Trend (24h)</h4>
                  
                  {/* CSS Chart */}
                  <div className="flex items-end justify-between h-28 pt-4 px-2 border-b border-border/50">
                    <div className="w-10 bg-amber-500/20 hover:bg-amber-500/30 transition-colors h-[40%] rounded-t relative group cursor-pointer"><span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-amber-500 hidden group-hover:block">70</span></div>
                    <div className="w-10 bg-amber-500/30 hover:bg-amber-500/40 transition-colors h-[60%] rounded-t relative group cursor-pointer"><span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-amber-500 hidden group-hover:block">72</span></div>
                    <div className="w-10 bg-amber-500/40 hover:bg-amber-500/50 transition-colors h-[75%] rounded-t relative group cursor-pointer"><span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-amber-500 hidden group-hover:block">78</span></div>
                    <div className="w-10 bg-amber-500/60 hover:bg-amber-500/70 transition-colors h-[50%] rounded-t relative group cursor-pointer"><span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-amber-500 hidden group-hover:block">71</span></div>
                    <div className="w-10 bg-amber-500/80 hover:bg-amber-500 transition-colors h-[65%] rounded-t relative group cursor-pointer"><span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-amber-500 hidden group-hover:block">73</span></div>
                  </div>
                  <div className="flex justify-between text-[8px] font-bold text-muted-foreground tracking-wider uppercase mt-2 px-1">
                    <span>08:00</span>
                    <span>12:00</span>
                    <span>16:00</span>
                    <span>20:00</span>
                    <span>24:00</span>
                  </div>
                </div>

                <div className="space-y-3 lg:col-span-1">
                  <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Metrics Parameters</h4>
                  <div className="p-3.5 rounded-xl bg-foreground/5 border border-border">
                    <span className="text-[10px] text-muted-foreground font-light">Latest Pulse</span>
                    <p className="text-lg font-bold text-amber-500 mt-1">73 bpm</p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-foreground/5 border border-border">
                    <span className="text-[10px] text-muted-foreground font-light">Oxygen Saturation</span>
                    <p className="text-lg font-bold text-amber-500 mt-1">98%</p>
                  </div>
                </div>
              </div>
            </div>
          );

        default:
          return null;
      }
    }

    return null;
  };

  return (
    <div className="flex w-full min-h-screen bg-background relative">
      
      {/* DESKTOP SIDEBAR */}
      <aside className={`hidden lg:flex flex-col bg-background/40 border-r border-border backdrop-blur-md fixed h-full z-30 transition-all duration-300 ${isSidebarCollapsed ? "w-20 p-4" : "w-64 p-6"}`}>
        <SidebarContent />
      </aside>

      {/* MOBILE SIDEBAR DRAWER OVERLAY */}
      <AnimatePresence>
        {isMobileSidebarOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
            />
            {/* Drawer */}
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="fixed top-0 left-0 w-64 h-full bg-background border-r border-border p-6 z-50 lg:hidden flex flex-col"
            >
              {/* Close Button */}
              <button 
                onClick={() => setIsMobileSidebarOpen(false)}
                className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-foreground/5 cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* MAIN VIEW CONTENT CONTAINER */}
      <div className={`flex-1 flex flex-col min-h-screen transition-all duration-300 ${isSidebarCollapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        
        {/* PORTAL TOPBAR HEADER */}
        <header className="w-full h-16 bg-background/30 border-b border-border/50 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3 text-left">
            <button
              onClick={() => setIsMobileSidebarOpen(true)}
              className="p-2 rounded-lg border border-border lg:hidden cursor-pointer hover:bg-foreground/5 text-muted-foreground hover:text-foreground"
            >
              <Menu className="w-4.5 h-4.5" />
            </button>
            <h2 className="text-sm font-bold tracking-tight text-foreground flex items-center gap-2">
              {roleDetails.name} Workspace
              <span className="text-[9px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
                {activeTab}
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {/* Real-time Dynamic Clock */}
            {mounted && currentTime && (
              <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-foreground/5 border border-border text-[10px] font-mono text-muted-foreground font-semibold">
                <Clock className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                {currentTime}
              </span>
            )}


            {/* Notification Bell */}
            <button className="p-2 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 dark:hover:bg-white/10 light:border-black/5 light:bg-black/5 light:hover:bg-black/10 transition-all text-muted-foreground hover:text-foreground cursor-pointer relative">
              <Bell className="w-4 h-4" />
              {fallAlert && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 animate-pulse border border-background" />
              )}
            </button>

            {/* Dark Mode Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 dark:hover:bg-white/10 light:border-black/5 light:bg-black/5 light:hover:bg-black/10 transition-all text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label="Toggle Theme"
            >
              {mounted && theme === "light" ? (
                <Moon className="w-4 h-4 text-amber-500" />
              ) : (
                <Sun className="w-4 h-4 text-amber-400" />
              )}
            </button>

            {/* User Profile Dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
                className="flex items-center gap-1.5 p-1 rounded-xl hover:bg-foreground/5 transition-all cursor-pointer border border-transparent hover:border-border/30 shrink-0"
              >
                <span className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center font-bold text-amber-500 text-xs border border-amber-500/20 shadow-sm shrink-0">
                  {roleDetails.profileName.split(" ").map(n => n[0]).join("")}
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground hidden sm:inline-block pr-1 select-none">
                  {roleDetails.profileName.split(",")[0]}
                </span>
              </button>

              <AnimatePresence>
                {isProfileDropdownOpen && (
                  <>
                    {/* Click-away backdrop */}
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setIsProfileDropdownOpen(false)}
                    />
                    
                    {/* Dropdown Menu */}
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 8 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-48 rounded-xl border border-border bg-zinc-950/95 backdrop-blur-md p-2 shadow-2xl z-50 text-left"
                    >
                      <div className="px-3 py-2">
                        <p className="text-xs font-bold text-foreground leading-none">{roleDetails.profileName}</p>
                        <p className="text-[9px] text-muted-foreground mt-1">{roleDetails.name}</p>
                      </div>
                      
                      <hr className="border-border/50 my-1.5" />
                      
                      <button
                        onClick={() => {
                          setIsProfileDropdownOpen(false);
                          if (activeRole === "SUPERADMIN") {
                            router.push("/superadmin/platform");
                          } else {
                            setShowSettingsModal(true);
                          }
                        }}
                        className="w-full px-3 py-2 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all text-left flex items-center gap-2 cursor-pointer"
                      >
                        <Settings className="w-3.5 h-3.5 text-amber-500" /> Settings
                      </button>
                      
                      <button
                        onClick={() => {
                          setIsProfileDropdownOpen(false);
                          triggerLogoutAlert();
                        }}
                        className="w-full px-3 py-2 rounded-lg text-xs font-semibold text-red-500 hover:text-red-400 hover:bg-red-500/5 transition-all text-left flex items-center gap-2 cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" /> Log Out
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* WORKSPACE CONTENT BODY */}
        <div className="flex-1 flex flex-col p-4 md:p-8 justify-start items-center">
          
          {/* Real-time Fall Warning Banner */}
          <AnimatePresence>
            {fallAlert && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -10 }}
                animate={{ opacity: 1, height: "auto", y: 0 }}
                exit={{ opacity: 0, height: 0, y: -10 }}
                className="w-full max-w-6xl p-4 mb-6 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 flex items-center justify-between gap-4 text-left shadow-lg"
              >
                <div className="flex items-center gap-3">
                  <span className="relative flex h-3 w-3 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  </span>
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <div>
                    <h4 className="text-sm font-bold">Fall Incident Alert - Room 12A</h4>
                    <p className="text-xs font-light opacity-80 mt-0.5">Optical Matrix detected a sudden posture anomaly at Arthur Pendelton's suite. Caretaker dispatched.</p>
                  </div>
                </div>
                <button 
                  onClick={() => { setFallAlert(false); setIsFallen(false); }}
                  className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors cursor-pointer"
                >
                  Dismiss Alert
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Dynamic Tab Selector content switch */}
          {renderTabContent()}

          {/* EDIT MODAL */}
          {editModalOpen && editModalData && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-md w-full space-y-6 p-6 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-foreground">
                    {editModalType === "incident" ? "Edit Incident" : "Edit Resident"}
                  </h2>
                  <button
                    onClick={() => setEditModalOpen(false)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  {editModalType === "incident" ? (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-2">Resident</label>
                        <input
                          type="text"
                          value={editModalData.resident}
                          onChange={(e) => setEditModalData({...editModalData, resident: e.target.value})}
                          className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-2">Room</label>
                        <input
                          type="text"
                          value={editModalData.room}
                          onChange={(e) => setEditModalData({...editModalData, room: e.target.value})}
                          className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-2">Type</label>
                        <input
                          type="text"
                          value={editModalData.type}
                          onChange={(e) => setEditModalData({...editModalData, type: e.target.value})}
                          className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-2">Severity</label>
                        <select
                          value={editModalData.severity}
                          onChange={(e) => setEditModalData({...editModalData, severity: e.target.value})}
                          className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                        >
                          <option value="Info">Info</option>
                          <option value="Warning">Warning</option>
                          <option value="Critical">Critical</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-2">Status</label>
                        <select
                          value={editModalData.status}
                          onChange={(e) => setEditModalData({...editModalData, status: e.target.value})}
                          className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                        >
                          <option value="Dispatched">Dispatched</option>
                          <option value="Resolved">Resolved</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-2">Name</label>
                        <input
                          type="text"
                          value={editModalData.name}
                          onChange={(e) => setEditModalData({...editModalData, name: e.target.value})}
                          className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-2">Room</label>
                        <input
                          type="text"
                          value={editModalData.room}
                          onChange={(e) => setEditModalData({...editModalData, room: e.target.value})}
                          className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-2">Care Level</label>
                        <input
                          type="text"
                          value={editModalData.care}
                          onChange={(e) => setEditModalData({...editModalData, care: e.target.value})}
                          className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-2">Sponsor</label>
                        <input
                          type="text"
                          value={editModalData.sponsor}
                          onChange={(e) => setEditModalData({...editModalData, sponsor: e.target.value})}
                          className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-2">Medications</label>
                        <textarea
                          value={editModalData.medications}
                          onChange={(e) => setEditModalData({...editModalData, medications: e.target.value})}
                          className="w-full px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:outline-none focus:border-amber-500 resize-none"
                          rows={3}
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="flex gap-2 pt-4">
                  <button
                    onClick={() => setEditModalOpen(false)}
                    className="flex-1 px-4 py-2 rounded-lg border border-border text-foreground text-xs font-semibold hover:bg-foreground/5 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (editModalType === "incident") {
                        setIncidents(incidents.map(inc => inc.id === editModalData.id ? editModalData : inc));
                      }
                      setEditModalOpen(false);
                    }}
                    className="flex-1 px-4 py-2 rounded-lg bg-amber-500 text-background text-xs font-semibold hover:bg-amber-600 transition-colors"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* ROLE-SPECIFIC PORTAL FOOTER */}
        <footer className="w-full py-6 border-t border-border/30 text-center text-[10px] text-muted-foreground mt-auto bg-background/20 backdrop-blur-sm">
          <div className="flex items-center justify-center gap-1.5">
            <Heart className="w-3.5 h-3.5 text-amber-500" />
            <span>{roleDetails.footerText}</span>
          </div>
        </footer>

        {/* SweetAlert Custom Modal */}
        <AnimatePresence>
          {showLogoutAlert && (
            <div key="logout-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={cancelLogout}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />

              {/* Alert Dialog Card */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 15 }}
                transition={{ type: "spring", duration: 0.4 }}
                className="relative w-full max-w-sm rounded-2xl p-6 bg-zinc-950 border border-white/20 text-center shadow-2xl z-10"
              >
                <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20 mb-4 animate-pulse">
                  <AlertTriangle className="w-6 h-6 text-amber-500" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">Are you sure?</h3>
                <p className="text-xs text-muted-foreground font-light mb-6">
                  You are about to log out of the active {roleDetails.name} simulated session.
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={cancelLogout}
                    className="px-4 py-2.5 rounded-xl border border-border bg-foreground/5 hover:bg-foreground/10 text-xs font-semibold text-foreground transition-all cursor-pointer w-24"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmLogout}
                    className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-black text-xs font-bold transition-all cursor-pointer w-28 shadow-lg shadow-amber-500/15"
                  >
                    Yes, Log Out
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {showSettingsModal && (
            <div key="settings-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowSettingsModal(false)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />

              {/* Settings Card */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 15 }}
                transition={{ type: "spring", duration: 0.4 }}
                className="relative w-full max-w-sm rounded-2xl p-6 bg-zinc-950 border border-white/20 text-left shadow-2xl z-10"
              >
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Settings className="w-4.5 h-4.5 text-amber-500" /> Preferences
                  </h3>
                  <button
                    onClick={() => setShowSettingsModal(false)}
                    className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <hr className="border-border/50 mb-4" />

                <div className="space-y-4 text-xs">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-foreground/5 border border-border">
                    <div>
                      <h4 className="font-semibold text-foreground">Sound Notifications</h4>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Toggle alert sound signals.</p>
                    </div>
                    <span className="text-[10px] text-green-500 font-bold bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/20">ACTIVE</span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg bg-foreground/5 border border-border">
                    <div>
                      <h4 className="font-semibold text-foreground">Auto-Sync Metrics</h4>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Background database updates.</p>
                    </div>
                    <span className="text-[10px] text-green-500 font-bold bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/20">ENABLED</span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg bg-foreground/5 border border-border">
                    <div>
                      <h4 className="font-semibold text-foreground">Language Preference</h4>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Primary language interface.</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-semibold">EN-US</span>
                  </div>
                </div>

                <div className="flex gap-3 justify-end mt-6">
                  <button
                    onClick={() => setShowSettingsModal(false)}
                    className="px-4 py-2 rounded-lg bg-foreground text-background text-xs font-bold transition-all hover:scale-[1.01] cursor-pointer"
                  >
                    Save & Close
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {/* AI Voice Assist Floating Widget (Bottom Right) */}
          {activeRole === "NURSE" && (
            <AnimatePresence key="voice-assist-presence">
              {!showVoicePopup && (
                <motion.button
                  key="voice-trigger-btn"
                  initial={{ opacity: 0, scale: 0.8, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: 20 }}
                  onClick={() => setShowVoicePopup(true)}
                  className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-amber-500 hover:bg-amber-600 shadow-lg flex items-center justify-center cursor-pointer transition-all hover:scale-110 hover:shadow-xl border border-amber-400/50"
                  title="Open Voice Assistant"
                >
                  <Mic className="w-6 h-6 text-white animate-pulse" />
                </motion.button>
              )}

              {showVoicePopup && (
                <motion.div
                  key="voice-widget-card"
                  initial={{ opacity: 0, scale: 0.9, y: 20, x: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20, x: 20 }}
                  transition={{ type: "spring", duration: 0.3 }}
                  className="fixed bottom-6 right-6 z-40 w-[480px] rounded-2xl p-6 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 border border-amber-500/40 text-left shadow-2xl shadow-amber-500/10 flex flex-col gap-5"
                >
                  {/* Header */}
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-bold text-amber-400 uppercase tracking-widest flex items-center gap-2">
                      <Mic className="w-6 h-6" /> Voice Assist
                    </h3>
                    <button
                      onClick={() => setShowVoicePopup(false)}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-foreground cursor-pointer transition-all"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Chat History Display */}
                  <div className="bg-zinc-950/60 rounded-xl p-4 border border-amber-500/20 min-h-[240px] max-h-[360px] overflow-y-auto flex flex-col gap-3">
                    {voiceChatHistory.length === 0 ? (
                      <p className="text-xs text-foreground/50 text-center italic py-6">
                        {isRecording ? "Listening..." : "Start speaking..."}
                      </p>
                    ) : (
                      voiceChatHistory.map((msg, idx) => (
                        <div key={`${idx}-${msg.role}-${msg.timestamp}`} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={`rounded-xl px-4 py-3 max-w-[85%] text-sm ${
                            msg.role === "user"
                              ? "bg-amber-500/20 border border-amber-500/40 text-amber-100"
                              : "bg-green-500/20 border border-green-500/40 text-green-100"
                          }`}>
                            <p className="font-bold text-xs mb-1">
                              {msg.role === "user" ? "👤 You" : "🤖 AI"}
                            </p>
                            <p className="leading-relaxed">{msg.text}</p>
                            <p className="text-[11px] opacity-60 mt-1.5">{msg.timestamp}</p>
                          </div>
                        </div>
                      ))
                    )}

                    {isRecording && voiceText && voiceText !== "Listening..." && (
                      <div className="flex justify-end">
                        <div className="rounded-xl px-4 py-3 max-w-[85%] bg-amber-500/30 border border-amber-500/50 text-amber-100 text-sm italic">
                          {voiceText}
                        </div>
                      </div>
                    )}

                    {isSpeaking && aiResponse && (
                      <div className="flex justify-start">
                        <div className="rounded-xl px-4 py-3 max-w-[85%] bg-green-500/30 border border-green-500/50 text-green-100 text-sm">
                          <div className="flex gap-1.5 mb-2">
                            <span className="w-2 h-2 rounded-full bg-green-400 animate-bounce" style={{ animationDelay: "0s" }} />
                            <span className="w-2 h-2 rounded-full bg-green-400 animate-bounce" style={{ animationDelay: "0.2s" }} />
                            <span className="w-2 h-2 rounded-full bg-green-400 animate-bounce" style={{ animationDelay: "0.4s" }} />
                          </div>
                          <p className="text-xs">{aiResponse}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Record Button */}
                  <button
                    onClick={toggleVoiceRecording}
                    disabled={isSpeaking}
                    className={`w-full py-4 rounded-xl font-bold text-base flex items-center justify-center gap-3 cursor-pointer transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed ${
                      isRecording
                        ? "bg-red-500/90 hover:bg-red-600 text-white shadow-lg shadow-red-500/30"
                        : isSpeaking
                        ? "bg-green-500/90 hover:bg-green-600 text-white shadow-lg shadow-green-500/30"
                        : "bg-amber-500/90 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/30"
                    }`}
                  >
                    {isRecording ? (
                      <>
                        <span className="w-3 h-3 rounded-full bg-white animate-pulse" />
                        Stop Recording
                      </>
                    ) : isSpeaking ? (
                      <>
                        <span className="w-3 h-3 rounded-full bg-white animate-bounce" />
                        AI Speaking...
                      </>
                    ) : (
                      <>
                        <Mic className="w-5 h-5" />
                        Start Speaking
                      </>
                    )}
                  </button>

                  {/* Typing Input Row */}
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={voiceTypedInput}
                      onChange={(e) => setVoiceTypedInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && voiceTypedInput.trim() && !isSpeaking) {
                          generateAndSpeakAIResponse(voiceTypedInput.trim());
                          setVoiceTypedInput("");
                        }
                      }}
                      disabled={isSpeaking || isRecording}
                      placeholder={isRecording ? "Listening via mic..." : "Type a message..."}
                      className="flex-1 bg-zinc-950/60 border border-amber-500/30 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-amber-500/70 focus:ring-1 focus:ring-amber-500/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                    <button
                      onClick={() => {
                        if (voiceTypedInput.trim() && !isSpeaking) {
                          generateAndSpeakAIResponse(voiceTypedInput.trim());
                          setVoiceTypedInput("");
                        }
                      }}
                      disabled={!voiceTypedInput.trim() || isSpeaking || isRecording}
                      className="p-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white transition-all hover:scale-105 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 cursor-pointer shadow-lg shadow-amber-500/30"
                      title="Send message"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                        <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                      </svg>
                    </button>
                  </div>

                  {/* Status Footer */}
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-2 pt-2 border-t border-amber-500/20">
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      isRecording ? "bg-red-500 animate-pulse" : isSpeaking ? "bg-green-500 animate-bounce" : "bg-green-500"
                    }`} />
                    {isRecording ? "Listening..." : isSpeaking ? "AI speaking..." : "Ready"}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </AnimatePresence>

        {/* FLOATING CHAT BUTTON - Family Portal Only */}
        {activeRole === "FAMILY" && (
          <>
            <button
              onClick={() => setShowFamilyChatModal(true)}
              className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-gradient-to-tr from-amber-500 to-amber-400 text-white shadow-lg hover:shadow-2xl hover:scale-110 transition-all active:scale-95 flex items-center justify-center border-2 border-amber-300/50"
              title="Open support chat"
            >
              <MessageSquare className="w-6 h-6" />
            </button>

            {/* Floating Chat Modal */}
            <AnimatePresence>
              {showFamilyChatModal && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowFamilyChatModal(false)}
                  className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 lg:z-40"
                />
              )}
            </AnimatePresence>

            <AnimatePresence>
              {showFamilyChatModal && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  transition={{ type: "spring", duration: 0.3 }}
                  className="fixed bottom-24 right-6 w-96 max-w-[calc(100vw-24px)] z-50 rounded-2xl shadow-2xl bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 border border-amber-500/30"
                >
                  {/* Header */}
                  <div className="bg-gradient-to-r from-amber-600/20 to-amber-500/20 border-b border-amber-500/20 p-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                        <MessageSquare className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-foreground">Golden Hearth Support</h3>
                        <p className="text-[10px] text-muted-foreground">AI Assistant</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowFamilyChatModal(false)}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Voice Status Indicator */}
                  {familyIsRecording && (
                    <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <p className="text-[10px] text-red-400 font-semibold">Recording...</p>
                    </div>
                  )}

                  {familyIsSpeaking && (
                    <div className="bg-green-500/10 border-b border-green-500/20 px-4 py-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <p className="text-[10px] text-green-400 font-semibold">AI Speaking...</p>
                    </div>
                  )}

                  {/* Chat Messages */}
                  <div className="flex flex-col h-80">
                    <div className="flex-1 overflow-y-auto space-y-4 p-4 scrollbar-thin scrollbar-thumb-amber-500/20 scrollbar-track-transparent">
                      {chatHistory.map((chat, idx) => (
                        <motion.div
                          key={`${idx}-${chat.sender}-${chat.text.slice(0, 10)}`}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`flex ${chat.sender === "user" ? "justify-end" : "justify-start"}`}
                        >
                          <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                            chat.sender === "user"
                              ? "bg-amber-500 text-black font-semibold"
                              : "bg-foreground/10 border border-amber-500/20 text-foreground font-light"
                          }`}>
                            {chat.text}
                          </div>
                        </motion.div>
                      ))}

                      {/* Voice Recognition Display */}
                      {familyVoiceText && familyVoiceText !== "Listening..." && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex justify-end"
                        >
                          <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-xs bg-amber-500/20 border border-amber-500/30 text-amber-100 italic">
                            {familyVoiceText}
                          </div>
                        </motion.div>
                      )}

                      {/* AI Response Display */}
                      {familyAiResponse && familyAiResponse !== "..." && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex justify-start"
                        >
                          <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-xs bg-green-500/10 border border-green-500/20 text-green-100 italic">
                            {familyAiResponse}
                          </div>
                        </motion.div>
                      )}
                    </div>

                    {/* Input Controls */}
                    <div className="border-t border-border/50 p-3 bg-background/50 space-y-2">
                      {/* Text Input Row */}
                      <form onSubmit={(e) => {
                        e.preventDefault();
                        if (chatMessage.trim()) {
                          familyGenerateAndSpeakAIResponse(chatMessage);
                          setChatMessage("");
                        }
                      }} className="flex gap-2">
                        <input
                          type="text"
                          value={chatMessage}
                          onChange={(e) => setChatMessage(e.target.value)}
                          placeholder="Type or use voice..."
                          className="flex-1 px-3 py-2 text-xs rounded-lg bg-foreground/5 border border-border focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20"
                        />
                        <button
                          type="submit"
                          className="px-3 py-2 rounded-lg bg-amber-500 text-black hover:bg-amber-400 active:scale-95 transition-all flex items-center justify-center cursor-pointer font-semibold"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      </form>

                      {/* Voice Control Buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={toggleFamilyVoiceRecording}
                          className={`flex-1 px-3 py-2 rounded-lg border text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 ${
                            familyIsRecording
                              ? "bg-red-500/20 border-red-500 text-red-400 animate-pulse shadow-md shadow-red-500/10"
                              : "border-border bg-foreground/5 text-muted-foreground hover:text-foreground hover:bg-foreground/10"
                          }`}
                        >
                          <Mic className="w-3.5 h-3.5" />
                          {familyIsRecording ? "Recording" : "Voice"}
                        </button>
                        <button
                          onClick={() => {
                            if ("speechSynthesis" in window) {
                              window.speechSynthesis.cancel();
                              const utterance = new SpeechSynthesisUtterance(familyAiResponse || chatHistory[chatHistory.length - 1]?.text || "No response available");
                              utterance.rate = 0.9;
                              utterance.pitch = 1.2;
                              window.speechSynthesis.speak(utterance);
                            }
                          }}
                          className="flex-1 px-3 py-2 rounded-lg border border-border bg-foreground/5 text-muted-foreground hover:text-foreground hover:bg-foreground/10 text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                          Speak
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

      </div>
    </div>
  );
}

export default function DashboardPortal() {
  return (
    <main className="min-h-screen bg-background text-foreground transition-colors duration-300">
      <Suspense fallback={
        <div className="min-h-screen flex flex-col items-center justify-center gap-2">
          <span className="w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
          <p className="text-xs text-muted-foreground">Loading workspace...</p>
        </div>
      }>
        <DashboardContent />
      </Suspense>
    </main>
  );
}
