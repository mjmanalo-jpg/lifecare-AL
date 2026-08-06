"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import ResidentHub from "./resident/ResidentHub";
import AppointmentCalendar from "@/components/portal/AppointmentCalendar";
import FamilyRelative from "@/components/portal/views/family/FamilyRelative";
import FamilyTimeline from "@/components/portal/views/family/FamilyTimeline";
import FamilyCareGoals from "@/components/portal/views/family/FamilyCareGoals";
import FamilyDailyReport from "@/components/portal/views/family/FamilyDailyReport";
import FamilyAlerts from "@/components/portal/views/family/FamilyAlerts";
import FamilyMessages from "@/components/portal/views/family/FamilyMessages";
import NurseMedications from "@/components/portal/views/NurseMedications";
import VaccinationTracker from "@/components/portal/views/clinical/VaccinationTracker";
import ResidentDocuments from "@/components/portal/views/clinical/ResidentDocuments";
import ClinicalReports from "@/components/portal/views/clinical/ClinicalReports";
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
  Users,
  Activity as StepIcon,
  Bot,
  Send,
  Mic,
  MicOff,
  MessageCircle,
} from "lucide-react";
import Link from "next/link";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { ASSISTANT_CONFIG_KEY, parseAssistantConfig, TONE_PREVIEW } from "@/lib/assistantConfig";
import { BROWSER_VOICE_MAP, pickBrowserVoice } from "@/lib/browserVoice";
import { detectSpeechLang } from "@/lib/speechLang";

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
  const [now, setNow] = useState<Date>(new Date());
  const [newGoalText, setNewGoalText] = useState("");
  
  // Modal states
  const [familyModalOpen, setFamilyModalOpen] = useState(false);
  const [roomServiceModalOpen, setRoomServiceModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [medsModalOpen, setMedsModalOpen] = useState(false);
  const [menuModalOpen, setMenuModalOpen] = useState(false);
  const [goalsModalOpen, setGoalsModalOpen] = useState(false);
  const [vitalsModalOpen, setVitalsModalOpen] = useState(false);
  const [stepsModalOpen, setStepsModalOpen] = useState(false);
  const [callBellModalOpen, setCallBellModalOpen] = useState(false);
  const [callBellTarget, setCallBellTarget] = useState<"Nurse" | "Caregiver" | "Nurse & Caregiver">("Nurse & Caregiver");
  const [callBellReason, setCallBellReason] = useState("");
  const [callBellNote, setCallBellNote] = useState("");
  const [sendingBell, setSendingBell] = useState(false);

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // Fetch app settings (voice + personality). Rows are stored tenant-scoped with
  // a composite id ("<org>:<comm>:<key>"), so look them up by `key`, not `id`.
  const { data: settingRows } = useLiveQuery<{ id: string; key?: string; value: string }>("app-settings", {
    tables: ["AppSetting"],
  });

  // Fetch resident's call bells
  const { data: callBellRows, refetch: refetchBells } = useLiveQuery<Record<string, unknown>>("call-bells", {
    query: "include=resident&take=50",
    tables: ["CallBell"],
  });

  // Fetch today's dining menu
  const { data: menuRows } = useLiveQuery<{ id: string; mealType: string; name: string; description: string | null; dietaryTags: string | null; imageUrl: string | null; menuDate: string }>("daily-menus", {
    tables: ["DailyMenu"],
  });

  // Fetch active staff for SOS notification
  const { data: staffRows } = useLiveQuery<{ id: string; position: string; user?: { firstName: string; lastName: string } }>("staff", {
    query: "include=user",
    tables: ["Staff"],
  });

  useEffect(() => {
    const saved = settingRows.find((r) => r.key === "assistantVoice" || r.id === "assistantVoice")?.value;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setVoice(saved);
  }, [settingRows]);

  // Personality configured by the Super Admin — live-synced via AppSetting,
  // so name/tone/greeting changes reach this dashboard without a refresh.
  const assistantCfg = useMemo(
    () => parseAssistantConfig(settingRows.find((r) => r.key === ASSISTANT_CONFIG_KEY || r.id === ASSISTANT_CONFIG_KEY)?.value),
    [settingRows]
  );

  // Keep the welcome bubble in sync with the configured greeting as long as
  // the resident hasn't started chatting yet.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAssistantMessages((prev) =>
      prev.length === 1 && prev[0].id === "welcome" && prev[0].text !== assistantCfg.greeting
        ? [{ ...prev[0], text: assistantCfg.greeting }]
        : prev
    );
  }, [assistantCfg.greeting]);

  // ── Realtime data: daily goals + custom goals from DB ──
  const { data: goalRows, refetch: refetchGoals } = useLiveQuery<{ id: string; residentId: string; title: string; isCompleted: boolean; isCustom: boolean; goalDate: string }>("resident-goals", {
    tables: ["ResidentGoal"],
  });

  // ── Realtime data: medication compliance log (today) ──
  const { data: complianceRows, refetch: refetchCompliance } = useLiveQuery<{ id: string; medicationId: string; takenAt: string }>("medication-logs", {
    tables: ["MedicationLog"],
  });

  // Derive a lookup map: medicationId -> true (if there's a log for today)
  const complianceMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    const today = new Date().toISOString().slice(0, 10);
    for (const row of complianceRows) {
      if (row.takenAt.slice(0, 10) === today) map[row.medicationId] = true;
    }
    return map;
  }, [complianceRows]);

  // Derive goals as a lookup: title -> { id, isCompleted }
  const goalsChecked = useMemo(() => {
    const map: Record<string, { id: string; checked: boolean }> = {};
    for (const g of goalRows.filter(r => !r.isCustom)) {
      map[g.title] = { id: g.id, checked: g.isCompleted };
    }
    return map;
  }, [goalRows]);

  const customGoals = useMemo(() =>
    goalRows.filter(r => r.isCustom).map(r => ({ id: r.id, name: r.title, checked: r.isCompleted })),
    [goalRows]
  );

  // Auto-seed 3 default daily goals on first load if none exist yet
  useEffect(() => {
    if (!resident?.id || goalRows.length > 0) return;
    const defaults = [
      { title: "Morning Walk", description: "Morning Walk (15 mins)" },
      { title: "Drink 2 Liters of Water", description: "Drink 2 Liters of Water" },
      { title: "Cognitive Puzzles Session", description: "Cognitive Puzzles Session" },
    ];
    (async () => {
      try {
        for (const d of defaults) {
          await createRecord("resident-goals", {
            residentId: resident.id,
            title: d.title,
            description: d.description,
            isCompleted: false,
            isCustom: false,
          });
        }
        refetchGoals();
      } catch (e) {
        console.warn("[auto-seed goals] skipped:", e);
      }
    })();
  }, [resident?.id, goalRows.length, refetchGoals]);

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

  const toggleGoal = async (goalTitle: string) => {
    if (!resident?.id) return;
    const existing = goalsChecked[goalTitle];
    if (existing) {
      await updateRecord("resident-goals", existing.id, { isCompleted: !existing.checked });
    } else {
      await createRecord("resident-goals", {
        residentId: resident.id,
        title: goalTitle,
        description: goalTitle,
        isCompleted: true,
        isCustom: false,
      });
    }
    refetchGoals();
  };

  const toggleCustomGoal = async (id: string) => {
    const goal = customGoals.find(g => g.id === id);
    if (!goal) return;
    await updateRecord("resident-goals", id, { isCompleted: !goal.checked });
    refetchGoals();
  };

  const addCustomGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resident?.id || !newGoalText.trim()) return;
    await createRecord("resident-goals", {
      residentId: resident.id,
      title: newGoalText.trim(),
      description: newGoalText.trim(),
      isCompleted: false,
      isCustom: true,
    });
    setNewGoalText("");
    refetchGoals();
    Swal.fire({
      title: "Goal Added",
      icon: "success",
      timer: 1000,
      showConfirmButton: false,
      toast: true,
      position: "top-end"
    });
  };

  const deleteCustomGoal = async (id: string) => {
    await deleteRecord("resident-goals", id);
    refetchGoals();
  };

  const toggleMedicationCompliance = async (medId: string) => {
    if (!resident?.id) return;
    const today = new Date().toISOString().slice(0, 10);
    // Check if there's already a log for today
    const existing = complianceRows.find(r => r.medicationId === medId && r.takenAt.slice(0, 10) === today);
    if (existing) {
      await deleteRecord("medication-logs", existing.id);
    } else {
      await createRecord("medication-logs", {
        residentId: resident.id,
        medicationId: medId,
      });
    }
    refetchCompliance();
  };

  // Generate dynamic wellness score based on variables
  const wellnessScore = useMemo(() => {
    if (!resident) return 0;
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

  // Active call bells for this resident
  const activeBells = useMemo(() => {
    if (!resident) return [];
    return callBellRows
      .filter((b) => b.residentId === resident.id && (b.status === "PENDING" || b.status === "RESPONDED"))
      .map((b) => ({
        id: String(b.id),
        status: String(b.status),
        reason: b.reason ? String(b.reason) : null,
        createdAt: b.createdAt ? String(b.createdAt) : null,
        respondedAt: b.respondedAt ? String(b.respondedAt) : null,
      }));
  }, [callBellRows, resident]);

  const cancelBell = async (bellId: string) => {
    try {
      await updateRecord("call-bells", bellId, { status: "CANCELLED", resolvedAt: new Date().toISOString() });
      await refetchBells();
      Swal.fire({ title: "Call Bell Cancelled", icon: "success", timer: 1200, showConfirmButton: false, toast: true, position: "top-end" });
    } catch {
      Swal.fire({ title: "Failed to cancel", icon: "error" });
    }
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
        await refetchBells();
        Swal.fire({
          title: "Emergency SOS Dispatched!",
          text: `${activeStaffNames} have been alerted.`,
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

  // Trigger call bell with reason and target
  const handleCallBell = async () => {
    if (!resident || !callBellReason) return;
    setSendingBell(true);
    try {
      await createRecord("call-bells", {
        residentId: resident.id,
        status: "PENDING",
        reason: `[${callBellTarget}] ${callBellReason}${callBellNote ? ` — ${callBellNote}` : ""}`,
      });
      await refetchBells();
      setCallBellModalOpen(false);
      setCallBellReason("");
      setCallBellNote("");
      Swal.fire({
        title: "Call Bell Sent!",
        text: `A ${callBellTarget.toLowerCase()} has been notified. Help is on the way.`,
        icon: "success",
        confirmButtonColor: "#10b981",
        timer: 2500,
        showConfirmButton: false,
      });
    } catch (err) {
      console.error(err);
      Swal.fire({
        title: "Call Bell Failed",
        text: "Could not send call bell. Please use the physical emergency cord.",
        icon: "error",
      });
    } finally {
      setSendingBell(false);
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
      // Food substitution goes to the KITCHEN as a service request — it shows on
      // the kitchen's cook list and the facility service-ticket board.
      await createRecord("service-requests", {
        residentId: resident.id,
        roomNumber: resident.roomNumber || null,
        category: "ROOM_SERVICE",
        subType: "Meal Substitution",
        details: menuSubText.trim(),
        source: "RESIDENT_PORTAL",
        priority: "ROUTINE",
        status: "ASSIGNED",
        assignedTeam: "KITCHEN",
      });
      setMenuModalOpen(false);
      setMenuSubText("");
      Swal.fire({
        title: "Sent to the Kitchen",
        text: "Your food substitution request was sent to the kitchen.",
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
    return hr ? `${hr.value} BPM` : "--";
  }, [vitals]);

  const heartRateNumeric = useMemo(() => {
    const hr = vitals.find((v) => v.type === "HEART_RATE");
    return hr ? parseInt(hr.value) : null;
  }, [vitals]);

  const heartRateStatus = useMemo(() => {
    if (heartRateNumeric === null) return { text: "No Data", color: "bg-gray-100 text-gray-500" };
    if (heartRateNumeric >= 60 && heartRateNumeric <= 100) return { text: "Within Range", color: "bg-emerald-50 text-emerald-600" };
    return { text: "Attention Needed", color: "bg-red-50 text-red-600" };
  }, [heartRateNumeric]);

  const activitySteps = useMemo(() => {
    const steps = vitals.find((v) => v.type === "STEPS" || v.type === "ACTIVITY_STEPS");
    return steps ? `${Number(steps.value).toLocaleString()} Steps` : "-- Steps";
  }, [vitals]);

  const activityGoalPct = useMemo(() => {
    if (goalRows.length === 0) return 0;
    const completed = goalRows.filter(g => g.isCompleted).length;
    return Math.round((completed / goalRows.length) * 100);
  }, [goalRows]);

  // Compute next medication dose from schedule/frequency
  const nextDoseTime = useMemo(() => {
    if (medications.length === 0) return null;
    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    // Common dose times parsed from frequency
    const doseTimes = [8, 12, 14, 18, 20]; // 8AM, 12PM, 2PM, 6PM, 8PM
    const next = doseTimes.find(t => t > currentHour || (t === currentHour && currentMin === 0));
    if (!next) return doseTimes[0]; // wraps to next morning
    const h = next % 12 || 12;
    const ampm = next < 12 ? "AM" : "PM";
    return `${h}:00 ${ampm}`;
  }, [medications]);

  // Today's menu filtered by current time of day
  const todayMenuItems = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return menuRows.filter(m => m.menuDate.slice(0, 10) === today);
  }, [menuRows]);

  // Active staff names for SOS
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const activeStaffNames = useMemo(() => {
    const active = staffRows.filter(s => s.user);
    const nurse = active.find(s => s.position?.toUpperCase().includes("NURSE"));
    const caregiver = active.find(s => s.position?.toUpperCase().includes("CAREGIVER"));
    const names: string[] = [];
    if (nurse?.user) names.push(`${nurse.user.firstName} ${nurse.user.lastName}`);
    if (caregiver?.user) names.push(`${caregiver.user.firstName} ${caregiver.user.lastName}`);
    if (names.length === 0) return "On-duty staff";
    if (names.length === 1) return names[0];
    return names.join(" and ");
  }, [staffRows]);


  // ── AI ASSISTANT CHAT TRANSCRIPT & CONTEXT INJECTIONS ──
  const buildResidentContext = () => {
    if (!resident) return "";
    const taskStr = todayTasks.map(t => `- ${t.title} at ${new Date(t.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${t.status})`).join("\n");
    const medStr = medications.map(m => `- ${m.name} (${m.dosage}, ${m.frequency})`).join("\n");
    const latestHR = vitals.find(v => v.type === "HEART_RATE")?.value || "Not recorded yet";
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
- Daily Activity Steps: ${activitySteps}`;
  };

  const handleSendAssistantMessage = async (text: string) => {
    const query = text.trim();
    if (!query || assistantThinking) return;
    
    setAssistantInput("");
    setAssistantThinking(true);
    
    // Add user message
    // eslint-disable-next-line react-hooks/purity
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

  // Text-To-Speech (Gemini with browser fallback). Uses the admin-selected
  // voice AND tone so the companion speaks in the configured personality.
  const speakTTS = async (text: string) => {
    stopTTS();
    setAssistantSpeaking(true);
    const toneStyle = TONE_PREVIEW[assistantCfg.tone] ?? TONE_PREVIEW.friendly;
    // Detect the reply language so Tagalog/Taglish is spoken natively, not with
    // an English accent, on both the Gemini and browser-fallback paths.
    const lang = detectSpeechLang(text);
    try {
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tts", text, provider: "auto", voiceId: voice, style: toneStyle.style, langName: lang.name }),
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
        u.lang = lang.code;
        // Honour the admin-selected voice: same gender + rate/pitch as the
        // preview, so choosing "Leda" never speaks in a male OS voice; and a
        // Filipino voice for Tagalog text when the OS has one.
        const cfg = BROWSER_VOICE_MAP[voice] ?? BROWSER_VOICE_MAP.Kore;
        u.rate = cfg.rate * toneStyle.rate;
        u.pitch = cfg.pitch * toneStyle.pitch;
        const preferred = pickBrowserVoice(voices, voice, lang.code);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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


  // Core SLMS Modules Aligned
  if (tab === "records") {
    return <FamilyRelative />;
  }
  if (tab === "rounds") {
    return <FamilyTimeline />;
  }
  if (tab === "careplans") {
    return <FamilyCareGoals />;
  }
  if (tab === "reports") {
    return <FamilyDailyReport />;
  }
  if (tab === "medications") {
    return <NurseMedications />;
  }
  if (tab === "escalations") {
    return <FamilyAlerts />;
  }
  if (tab === "messages") {
    return <FamilyMessages />;
  }
  if (tab === "vaccinations") {
    return <VaccinationTracker />;
  }
  if (tab === "documents") {
    return <ResidentDocuments />;
  }
  if (tab === "clinicalreports") {
    return <ClinicalReports />;
  }

  // Loading state skeleton
  if (tab && tab !== "dashboard") {
    const hubTab = (["report", "appointments", "transport", "services", "community"].includes(tab) ? tab : "report") as "report";
    return <ResidentHub initialTab={hubTab} />;
  }

  if (profileLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-gray-500">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mb-4" />
        <span className="text-sm font-semibold">Syncing with your care database...</span>
      </div>
    );
  }

  const residentName = resident ? `${resident.firstName} ${resident.lastName}` : "";
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 space-y-6 sm:space-y-8 select-none relative">
      
      {/* ── TOP GREETING HEADER ── */}
      <div className="bg-white p-5 sm:p-8 rounded-3xl border border-gray-100 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="min-w-0 space-y-2">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-gray-900 tracking-tight truncate">
              {now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening"}, {resident?.firstName || "there"}
            </h1>
            <p className="text-gray-600 text-base sm:text-lg md:text-xl leading-relaxed">
              Happy {dayName}. You have{" "}
              <span className="font-bold text-blue-700">{todayTasks.filter(t => t.status !== "COMPLETED").length}</span>{" "}
              {todayTasks.filter(t => t.status !== "COMPLETED").length === 1 ? "activity" : "activities"} left today.
            </p>
          </div>

          {/* Wellness score — clean, large, easy to read */}
          <div className="flex items-center gap-4 bg-gray-50 rounded-2xl px-5 py-4 shrink-0 self-start md:self-auto">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-blue-600 flex items-center justify-center shrink-0">
              <TrendingUp className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-500">Wellness score</div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl sm:text-5xl font-extrabold text-gray-900">{wellnessScore}</span>
                <span className={`text-sm px-2.5 py-1 rounded-full font-bold ${wellnessLabel(wellnessScore).color}`}>
                  {wellnessLabel(wellnessScore).text}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── GRID LAYOUT (Mockup style) ── */}
      {resident && (
        <div className="mb-4 sm:mb-6">
          <AppointmentCalendar residentId={String(resident.id)} residentName={`${String(resident.firstName ?? "")} ${String(resident.lastName ?? "")}`.trim()} title="My Calendar" />
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
        
        {/* ── COL 1: Today's Schedule (span 4) ── */}
        <div
          onClick={() => setScheduleModalOpen(true)}
          className="lg:col-span-4 bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 shadow-sm flex flex-col h-auto lg:h-[600px] hover:border-blue-400 hover:shadow-md transition cursor-pointer"
        >
          <div className="flex items-center justify-between pb-4 border-b border-gray-100">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Calendar className="w-6 h-6 text-blue-600" /> Today&apos;s Schedule
            </h2>
            <span className="text-sm font-semibold text-blue-600 px-3 py-1 bg-blue-50 rounded-full">
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
                          <span className="text-sm font-bold text-blue-600">
                            {new Date(task.dueDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                          </span>
                          {task.priority === "URGENT" && (
                            <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs font-bold">URGENT</span>
                          )}
                        </div>
                        <h4 className={`text-base font-bold mt-1 text-gray-900 ${isDone ? "line-through text-gray-400" : ""}`}>
                          {task.title}
                        </h4>
                        {task.description && (
                          <p className={`text-sm mt-1 leading-relaxed line-clamp-2 ${isDone ? "text-gray-400" : "text-gray-600"}`}>
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
          <div className="pt-3 border-t border-gray-100 text-center text-sm text-blue-600 font-bold flex items-center justify-center gap-1">
            Tap to see full schedule <ChevronRight className="w-4 h-4" />
          </div>
        </div>

        {/* ── COL 2: Medications & Vitals & SOS (span 5) ── */}
        <div className="lg:col-span-5 space-y-4 sm:space-y-6 flex flex-col h-auto lg:h-[600px] justify-between">
          
          {/* Medications Card */}
          <div 
            onClick={() => setMedsModalOpen(true)}
            className="bg-blue-600 rounded-2xl p-4 sm:p-6 text-white shadow-md flex-1 flex flex-col justify-between mb-2 hover:bg-blue-700 hover:shadow-lg transition cursor-pointer border border-blue-500"
          >
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-blue-500/30">
                <h3 className="text-xl font-bold flex items-center gap-2 text-white">
                  <Pill className="w-6 h-6 text-white" /> Upcoming Medications
                </h3>
                <span className="text-xs font-black bg-blue-700/50 px-2.5 py-1 rounded text-blue-100 tracking-wide">
                  {nextDoseTime ? `Next dose: ${nextDoseTime}` : "No doses scheduled"}
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
                          <Pill className="w-5 h-5 text-blue-100" />
                          <div>
                            <div className={`text-base font-bold ${isChecked ? "text-blue-200 line-through" : "text-white"}`}>
                              {med.name}
                            </div>
                            <div className="text-sm text-blue-100">
                              {med.dosage} • {med.frequency}
                            </div>
                          </div>
                        </div>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center transition border-2 ${
                          isChecked ? "bg-emerald-500 border-emerald-500 text-white" : "border-blue-200"
                        }`}>
                          {isChecked && <CheckCircle2 className="w-4 h-4" />}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            
            <div className="flex items-center justify-between text-sm text-blue-100 pt-3 border-t border-blue-500/30">
              <span>Tap to mark as taken</span>
              <span className="font-bold flex items-center gap-0.5">View details <ChevronRight className="w-4 h-4" /></span>
            </div>
          </div>

          {/* Vitals Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">

            {/* Heart Rate */}
            <div
              onClick={() => setVitalsModalOpen(true)}
              className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-sm hover:border-red-400 hover:shadow-md transition cursor-pointer"
            >
              <div className="flex items-center gap-2 pb-1">
                <Heart className="w-5 h-5 sm:w-6 sm:h-6 text-red-500 fill-red-50" />
                <span className="text-sm font-semibold text-gray-600">Heart Rate</span>
              </div>
              <div className="text-3xl sm:text-4xl font-extrabold text-gray-900">{heartRate}</div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full mt-2 inline-block ${heartRateStatus.color}`}>
                {heartRateStatus.text}
              </span>
            </div>

            {/* Activity Steps */}
            <div
              onClick={() => setStepsModalOpen(true)}
              className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-sm hover:border-blue-400 hover:shadow-md transition cursor-pointer"
            >
              <div className="flex items-center gap-2 pb-1">
                <Activity className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />
                <span className="text-sm font-semibold text-gray-600">Activity</span>
              </div>
              <div className="text-3xl sm:text-4xl font-extrabold text-gray-900">{activitySteps}</div>
              <span className="text-xs text-blue-700 font-bold px-2.5 py-1 bg-blue-50 rounded-full mt-2 inline-block">
                Daily Goal: {activityGoalPct}%
              </span>
            </div>

          </div>

          {/* ── Active Call Bell Banner ── */}
          {activeBells.length > 0 && (
            <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </span>
                <span className="text-sm font-black text-red-800 uppercase tracking-wider">
                  Help Requested — {activeBells.length === 1 ? "1 active bell" : `${activeBells.length} active bells`}
                </span>
              </div>
              <div className="space-y-2">
                {activeBells.map((bell) => (
                  <div key={bell.id} className="flex items-center justify-between bg-white rounded-xl px-3 py-2.5 border border-red-200">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-red-700 truncate">{bell.reason || "Help Request"}</p>
                      <p className="text-xs text-red-500">
                        Status: <span className="font-semibold">{bell.status === "RESPONDED" ? "Staff en route" : "Waiting for staff"}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => cancelBell(bell.id)}
                      className="ml-3 px-3.5 py-2 text-xs font-bold uppercase tracking-wide bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition active:scale-95 flex-shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Action buttons — large, obvious, one tap */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">

            {/* CALL BELL — the safety action, most prominent */}
            <button
              onClick={() => setCallBellModalOpen(true)}
              className="py-5 sm:py-6 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold rounded-2xl text-center shadow-sm hover:shadow-md transition flex flex-col items-center justify-center gap-2"
            >
              <Bell className="w-8 h-8" />
              <span className="text-sm sm:text-base">Call Bell</span>
            </button>

            {/* CALL FAMILY */}
            <button
              onClick={() => setFamilyModalOpen(true)}
              className="py-5 sm:py-6 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold rounded-2xl text-center shadow-sm hover:shadow-md transition flex flex-col items-center justify-center gap-2"
            >
              <PhoneCall className="w-8 h-8" />
              <span className="text-sm sm:text-base">Call Family</span>
            </button>

            {/* ROOM SERVICE */}
            <button
              onClick={() => setRoomServiceModalOpen(true)}
              className="py-5 sm:py-6 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-bold rounded-2xl text-center shadow-sm hover:shadow-md transition flex flex-col items-center justify-center gap-2"
            >
              <Coffee className="w-8 h-8" />
              <span className="text-sm sm:text-base">Room Service</span>
            </button>

          </div>

        </div>

        {/* ── COL 3: Dining Menu & Daily Goals (span 3) ── */}
        <div className="lg:col-span-3 space-y-4 sm:space-y-6 flex flex-col h-auto lg:h-[600px] justify-between">
          
          {/* Today's Menu */}
          <div 
            onClick={() => setMenuModalOpen(true)}
            className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-sm flex-1 overflow-y-auto custom-scrollbar flex flex-col justify-between mb-2 hover:border-amber-400 hover:shadow-md transition cursor-pointer"
          >
            <div>
              <h3 className="text-xl font-bold text-gray-900 pb-3 border-b border-gray-100 flex items-center gap-2">
                <Utensils className="w-6 h-6 text-amber-500" /> Today&apos;s Menu
              </h3>

              <div className="mt-3 space-y-4">
                {todayMenuItems.length === 0 ? (
                  <div className="text-center py-6 text-gray-400">
                    <Utensils className="w-8 h-8 mx-auto text-gray-200 mb-2" />
                    <p className="text-sm">No menu set for today yet.</p>
                  </div>
                ) : (
                  todayMenuItems.slice(0, 2).map((item) => (
                    <div key={item.id} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs uppercase tracking-wide font-extrabold text-amber-600">{item.mealType}</span>
                        {item.dietaryTags && (
                          <span className="text-xs font-bold px-2 py-0.5 bg-blue-50 text-blue-600 rounded">{item.dietaryTags.split(",")[0]}</span>
                        )}
                      </div>
                      {item.imageUrl ? (
                        <div className="h-24 w-full bg-cover bg-center rounded-lg relative border border-gray-100" style={{ backgroundImage: `url('${item.imageUrl}')` }}>
                          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent rounded-lg flex items-end p-2">
                            <span className="text-white text-base font-black truncate">{item.name}</span>
                          </div>
                        </div>
                      ) : (
                        <>
                          <h4 className="text-base font-bold text-gray-900">{item.name}</h4>
                          {item.description && <p className="text-sm text-gray-600 leading-normal line-clamp-2">{item.description}</p>}
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="text-sm text-amber-600 font-bold text-center pt-2 flex items-center justify-center gap-0.5 border-t border-gray-50">
              See full dining menu <ChevronRight className="w-4 h-4" />
            </div>
          </div>

          {/* Daily Goals */}
          <div 
            onClick={() => setGoalsModalOpen(true)}
            className="bg-teal-800 rounded-2xl p-4 sm:p-5 text-white shadow-md flex flex-col justify-between h-auto lg:h-[210px] hover:bg-teal-900 hover:shadow-lg transition cursor-pointer border border-teal-700"
          >
            <div>
              <h3 className="text-xl font-bold flex items-center gap-2 pb-2 border-b border-teal-700/50 text-white">
                <CheckCircle2 className="w-6 h-6 text-teal-300" /> Daily Goals
              </h3>

              <div className="space-y-3 mt-3">
                {/* Goal 1 */}
                <label className="flex items-center gap-3 cursor-pointer text-base select-none" onClick={(e) => { e.stopPropagation(); toggleGoal("Morning Walk"); }}>
                  <input
                    type="checkbox"
                    checked={goalsChecked["Morning Walk"]?.checked || false}
                    readOnly
                    className="w-5 h-5 rounded border-teal-600 text-teal-600 focus:ring-teal-500 bg-teal-900"
                  />
                  <span className={goalsChecked["Morning Walk"]?.checked ? "line-through text-teal-300" : "text-white"}>
                    Morning Walk (15 mins)
                  </span>
                </label>

                {/* Goal 2 */}
                <label className="flex items-center gap-3 cursor-pointer text-base select-none" onClick={(e) => { e.stopPropagation(); toggleGoal("Drink 2 Liters of Water"); }}>
                  <input
                    type="checkbox"
                    checked={goalsChecked["Drink 2 Liters of Water"]?.checked || false}
                    readOnly
                    className="w-5 h-5 rounded border-teal-600 text-teal-600 focus:ring-teal-500 bg-teal-900"
                  />
                  <span className={goalsChecked["Drink 2 Liters of Water"]?.checked ? "line-through text-teal-300" : "text-white"}>
                    Drink 2 Liters of Water
                  </span>
                </label>
              </div>
            </div>

            <div className="text-sm text-teal-200 text-center font-bold flex items-center justify-center gap-0.5 pt-2 border-t border-teal-700/30">
              Manage &amp; add goals <ChevronRight className="w-4 h-4" />
            </div>
          </div>

        </div>

      </div>

      {/* ── 1. TODAY'S SCHEDULE DETAIL VIEW MODAL ── */}
      {scheduleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-4 sm:px-6 py-4 bg-blue-600 text-white flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-base sm:text-lg flex items-center gap-2">
                <Calendar className="w-5 h-5" /> Today&apos;s Complete Schedule
              </h3>
              <button onClick={() => setScheduleModalOpen(false)} className="p-1 hover:bg-blue-700 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
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
            
            <div className="px-4 sm:px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex justify-end flex-shrink-0">
              <button
                onClick={() => setScheduleModalOpen(false)}
                className="px-4 sm:px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg transition text-sm"
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
            <div className="px-4 sm:px-6 py-4 bg-blue-700 text-white flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-base sm:text-lg flex items-center gap-2">
                <Pill className="w-5 h-5" /> Active Medications & Prescriptions
              </h3>
              <button onClick={() => setMedsModalOpen(false)} className="p-1 hover:bg-blue-800 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
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
            
            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex justify-end flex-shrink-0">
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
            <div className="px-4 sm:px-6 py-4 bg-amber-500 text-white flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-base sm:text-lg flex items-center gap-2">
                <Utensils className="w-5 h-5" /> Today&apos;s Dining & Substitutions
              </h3>
              <button onClick={() => setMenuModalOpen(false)} className="p-1 hover:bg-amber-600 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            
            <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {todayMenuItems.length === 0 ? (
                  <div className="col-span-3 text-center py-8 text-gray-400">
                    <Utensils className="w-10 h-10 mx-auto text-gray-200 mb-2" />
                    <p className="font-semibold text-sm">No menu set for today</p>
                    <p className="text-xs mt-1">The kitchen hasn&apos;t published today&apos;s menu yet.</p>
                  </div>
                ) : (
                  todayMenuItems.map((item) => (
                    <div key={item.id} className="border border-gray-200 rounded-xl p-4 bg-amber-50/20">
                      <div className="text-[10px] font-black uppercase text-amber-600 tracking-wider">{item.mealType}</div>
                      <h4 className="font-black text-gray-900 mt-1 text-sm">{item.name}</h4>
                      {item.description && (
                        <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{item.description}</p>
                      )}
                      {item.dietaryTags && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.dietaryTags.split(",").map((tag, i) => (
                            <span key={i} className="text-[8px] px-1 bg-amber-100 text-amber-800 rounded font-bold">{tag.trim()}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Substitution input */}
              <div className="border-t border-gray-100 pt-5 space-y-3">
                <h4 className="text-sm font-bold text-gray-900">Request Meal Substitution</h4>
                <p className="text-xs text-gray-500">Not feeling like having salmon or salad? Type your dietary preference below to alert the chef.</p>
                <div className="flex flex-col sm:flex-row gap-3">
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
                    className="px-5 py-2 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 transition text-sm flex items-center justify-center gap-1.5"
                  >
                    {submittingMenuSub && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                    Submit
                  </button>
                </div>
              </div>
            </div>
            
            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex justify-end flex-shrink-0">
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
            <div className="px-4 sm:px-6 py-4 bg-teal-800 text-white flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-base sm:text-lg flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-teal-300" /> Daily Health Goals Planner
              </h3>
              <button onClick={() => setGoalsModalOpen(false)} className="p-1 hover:bg-teal-900 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            
            <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
              <div>
                <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2">Native Goals</h4>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer p-3 bg-teal-50/20 border border-gray-100 rounded-xl text-sm select-none">
                    <input
                      type="checkbox"
                      checked={goalsChecked["Morning Walk"]?.checked || false}
                      onChange={() => toggleGoal("Morning Walk")}
                      className="w-4 h-4 rounded border-teal-600 text-teal-600 focus:ring-teal-500"
                    />
                    <span className={goalsChecked["Morning Walk"]?.checked ? "line-through text-gray-400 font-semibold" : "text-gray-800 font-bold"}>
                      Morning Walk (15 mins) - Maintain aerobic cardiovascular health
                    </span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer p-3 bg-teal-50/20 border border-gray-100 rounded-xl text-sm select-none">
                    <input
                      type="checkbox"
                      checked={goalsChecked["Drink 2 Liters of Water"]?.checked || false}
                      onChange={() => toggleGoal("Drink 2 Liters of Water")}
                      className="w-4 h-4 rounded border-teal-600 text-teal-600 focus:ring-teal-500"
                    />
                    <span className={goalsChecked["Drink 2 Liters of Water"]?.checked ? "line-through text-gray-400 font-semibold" : "text-gray-800 font-bold"}>
                      Drink 2 Liters of Water - Essential hydration log
                    </span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer p-3 bg-teal-50/20 border border-gray-100 rounded-xl text-sm select-none">
                    <input
                      type="checkbox"
                      checked={goalsChecked["Cognitive Puzzles Session"]?.checked || false}
                      onChange={() => toggleGoal("Cognitive Puzzles Session")}
                      className="w-4 h-4 rounded border-teal-600 text-teal-600 focus:ring-teal-500"
                    />
                    <span className={goalsChecked["Cognitive Puzzles Session"]?.checked ? "line-through text-gray-400 font-semibold" : "text-gray-800 font-bold"}>
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
            
            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex justify-end flex-shrink-0">
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
            <div className="px-4 sm:px-6 py-4 bg-blue-600 text-white flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-base sm:text-lg flex items-center gap-2">
                <HeartPulse className="w-5 h-5 text-white" /> Vitals History Logs
              </h3>
              <button onClick={() => setVitalsModalOpen(false)} className="p-1 hover:bg-blue-700 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
              <p className="text-sm text-gray-500">Your recent health measurements. Clinical staff records these logs during checkups.</p>
              
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm overflow-x-auto">
                <table className="w-full min-w-[480px] text-left border-collapse text-sm">
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
                        
                        const displayType = v.type.replace(/_/g, " ");
                        let alert = false;
                        if (isHR) {
                          const val = parseInt(v.value);
                          if (val > 100 || val < 55) alert = true;
                        } else if (isBP) {
                          const parts = v.value.split("/");
                          if (parts.length === 2) {
                            const sys = parseInt(parts[0]);
                            const dia = parseInt(parts[1]);
                            if (sys > 140 || sys < 90 || dia > 90 || dia < 60) alert = true;
                          }
                        } else if (isOxy) {
                          const val = parseInt(v.value);
                          if (val < 90) alert = true;
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
            
            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex justify-end flex-shrink-0">
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

      {/* ── 5b. ACTIVITY STEPS DETAIL VIEW MODAL ── */}
      {stepsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-4 sm:px-6 py-4 bg-gradient-to-r from-indigo-500 to-violet-600 text-white flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-base sm:text-lg flex items-center gap-2">
                <StepIcon className="w-5 h-5 text-white" /> Activity Steps Tracker
              </h3>
              <button onClick={() => setStepsModalOpen(false)} className="p-1 hover:bg-white/20 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            
            <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
              {/* Hero stats */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-indigo-50 rounded-xl p-4 text-center border border-indigo-100">
                  <p className="text-[10px] sm:text-xs font-semibold text-indigo-500 uppercase tracking-wider mb-1">Today</p>
                  <p className="text-2xl sm:text-3xl font-black text-indigo-900">{activitySteps.replace(" Steps", "")}</p>
                  <p className="text-[10px] text-indigo-400 mt-1">steps recorded</p>
                </div>
                <div className="bg-violet-50 rounded-xl p-4 text-center border border-violet-100">
                  <p className="text-[10px] sm:text-xs font-semibold text-violet-500 uppercase tracking-wider mb-1">Goal</p>
                  <p className="text-2xl sm:text-3xl font-black text-violet-900">{activityGoalPct}%</p>
                  <p className="text-[10px] text-violet-400 mt-1">completion</p>
                </div>
                <div className="col-span-2 bg-emerald-50 rounded-xl p-4 text-center border border-emerald-100">
                  <p className="text-[10px] sm:text-xs font-semibold text-emerald-500 uppercase tracking-wider mb-1">Goals Done</p>
                  <p className="text-2xl sm:text-3xl font-black text-emerald-900">{goalRows.filter(g => g.isCompleted).length}<span className="text-lg">/{goalRows.length}</span></p>
                  <p className="text-[10px] text-emerald-400 mt-1">of daily goals</p>
                </div>
              </div>

              {/* Goal progress bar */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-bold text-gray-800">Daily Goal Progress</h4>
                  <span className="text-xs font-semibold text-indigo-600">{activityGoalPct}%</span>
                </div>
                <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-700"
                    style={{ width: `${Math.min(activityGoalPct, 100)}%` }}
                  />
                </div>
              </div>

              {/* Steps history from vitals */}
              <div>
                <h4 className="text-sm font-bold text-gray-800 mb-3">Steps History</h4>
                {vitals.filter(v => v.type === "STEPS" || v.type === "ACTIVITY_STEPS").length === 0 ? (
                  <div className="text-center py-8 text-gray-400 italic text-sm">No step records logged yet.</div>
                ) : (
                  <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm overflow-x-auto">
                    <table className="w-full min-w-[360px] text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Steps</th>
                          <th className="px-4 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-gray-800">
                        {vitals
                          .filter(v => v.type === "STEPS" || v.type === "ACTIVITY_STEPS")
                          .map((v) => {
                            const count = Number(v.value);
                            const reached = count >= 4000;
                            return (
                              <tr key={v.id} className="hover:bg-gray-50 transition">
                                <td className="px-4 py-3 text-xs text-gray-500">
                                  {new Date(v.recordedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </td>
                                <td className="px-4 py-3 font-black text-gray-900">{count.toLocaleString()}</td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    reached ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                                  }`}>
                                    {reached ? "Goal Reached" : "In Progress"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
            
            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex justify-end flex-shrink-0">
              <button
                onClick={() => setStepsModalOpen(false)}
                className="px-5 py-2 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-bold rounded-lg transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CALL FAMILY MODAL ── */}
      {familyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-4 sm:px-6 py-4 bg-blue-600 text-white flex items-center justify-between">
              <h3 className="font-bold text-base sm:text-lg flex items-center gap-2">
                <Phone className="w-5 h-5" /> Family Contact Details
              </h3>
              <button onClick={() => setFamilyModalOpen(false)} className="p-1 hover:bg-blue-700 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            
            <div className="p-4 sm:p-6 space-y-4">
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
            
            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-4 sm:px-6 py-4 bg-amber-500 text-white flex items-center justify-between">
              <h3 className="font-bold text-base sm:text-lg flex items-center gap-2">
                <Coffee className="w-5 h-5 text-white" /> Request Room Service
              </h3>
              <button onClick={() => setRoomServiceModalOpen(false)} className="p-1 hover:bg-amber-600 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4">
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

            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex flex-wrap justify-end gap-3">
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

      {/* ── CALL BELL MODAL ── */}
      {callBellModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-4 sm:px-6 py-4 bg-red-600 text-white flex items-center justify-between">
              <h3 className="font-bold text-base sm:text-lg flex items-center gap-2">
                <Bell className="w-5 h-5 text-white" /> Call for Help
              </h3>
              <button onClick={() => setCallBellModalOpen(false)} className="p-1 hover:bg-red-700 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4">
              <p className="text-sm text-gray-600">Select who you need and the reason. The nearest available staff member will be notified immediately.</p>

              {/* Target selection */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider">Who do you need?</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(["Nurse", "Caregiver", "Nurse & Caregiver"] as const).map((target) => (
                    <button
                      key={target}
                      onClick={() => setCallBellTarget(target)}
                      className={`py-3 rounded-xl border-2 text-sm font-bold transition active:scale-95 ${
                        callBellTarget === target
                          ? "border-red-500 bg-red-50 text-red-700"
                          : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      {target === "Nurse" && <HeartPulse className="w-4 h-4 mx-auto mb-1" />}
                      {target === "Caregiver" && <User className="w-4 h-4 mx-auto mb-1" />}
                      {target === "Nurse & Caregiver" && <Users className="w-4 h-4 mx-auto mb-1" />}
                      {target}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reason selection */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider">Reason for call</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    { label: "Feeling unwell", icon: "🤒" },
                    { label: "Pain", icon: "😣" },
                    { label: "Need assistance", icon: "🤝" },
                    { label: "Bathroom help", icon: "🚽" },
                    { label: "Medication needed", icon: "💊" },
                    { label: "Fall / Emergency", icon: "🚨" },
                  ] as const).map((reason) => (
                    <button
                      key={reason.label}
                      onClick={() => setCallBellReason(reason.label)}
                      className={`px-3 py-2.5 rounded-xl border-2 text-xs font-bold text-left transition active:scale-95 ${
                        callBellReason === reason.label
                          ? "border-red-500 bg-red-50 text-red-700"
                          : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      <span className="mr-1">{reason.icon}</span> {reason.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Optional note */}
              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1">Additional note (optional)</label>
                <textarea
                  value={callBellNote}
                  onChange={(e) => setCallBellNote(e.target.value)}
                  rows={2}
                  placeholder="Anything staff should know..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-400 outline-none text-sm resize-none"
                />
              </div>
            </div>

            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-100 flex flex-wrap justify-end gap-3">
              <button
                onClick={() => setCallBellModalOpen(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleCallBell}
                disabled={!callBellReason || sendingBell}
                className="px-5 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white font-bold rounded-lg hover:shadow-lg transition active:scale-95 text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {sendingBell && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                <Bell className="w-4 h-4" /> Send Call Bell
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
                🗓️ Today&apos;s Schedule
              </button>
              <button 
                onClick={() => handleSendAssistantMessage("What is on the dining menu?")}
                className="px-3 py-1 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 text-blue-900 font-bold rounded-full text-xs flex-shrink-0 transition active:scale-95"
              >
                🥗 Today&apos;s Menu
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
