"use client";
import { useMemo, useState, useCallback } from "react";
import {
  Stethoscope, Search, Plus, X, RefreshCw, ChevronRight, ChevronLeft, Clock,
  CheckCircle2, AlertTriangle, Smile, Moon, Footprints, Utensils,
  Activity, Droplets, ClipboardList, Trash2, Loader2,
  type LucideIcon, Wind, Frown, Meh, SmilePlus, Annoyed,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:border-transparent outline-none text-sm";
const labelCls = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1";
const selectCls = inputCls + " bg-white";
const btnPrimary = "px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm transition-colors";
const btnDanger = "px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 text-xs font-medium";
const btnSecondary = "px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-xs font-medium";

type TabKey = "bowel" | "urine" | "edema" | "concerns" | "pain" | "mood" | "sleep" | "mobility" | "meals" | "vitals";

const TABS: { key: TabKey; label: string; icon: LucideIcon; color: string }[] = [
  { key: "bowel", label: "Bowel", icon: Droplets, color: "text-amber-600" },
  { key: "urine", label: "Urine", icon: Droplets, color: "text-yellow-600" },
  { key: "edema", label: "Edema", icon: Wind, color: "text-blue-600" },
  { key: "concerns", label: "Concerns", icon: AlertTriangle, color: "text-red-600" },
  { key: "pain", label: "Pain", icon: Activity, color: "text-orange-600" },
  { key: "mood", label: "Mood", icon: Smile, color: "text-purple-600" },
  { key: "sleep", label: "Sleep", icon: Moon, color: "text-indigo-600" },
  { key: "mobility", label: "Mobility", icon: Footprints, color: "text-teal-600" },
  { key: "meals", label: "Meals", icon: Utensils, color: "text-green-600" },
  { key: "vitals", label: "Vitals", icon: Activity, color: "text-rose-600" },
];

const MOOD_ICONS: Record<string, LucideIcon> = {
  CALM: Meh, HAPPY: SmilePlus, SAD: Frown, ANXIOUS: Annoyed,
  AGITATED: Annoyed, CONFUSED: Meh, AGGRESSIVE: AlertTriangle,
  WITHDRAWN: Frown, COOPERATIVE: SmilePlus, APATHETIC: Meh,
};

const timeNow = () => new Date().toISOString();
const todayDate = () => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); };

export default function DailyRoundsBoard({ clinicianRole = "CAREGIVER" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName, userId: clinicianId } = useClinician(clinicianRole);
  const [tab, setTab] = useState<TabKey>("bowel");
  const [selectedResident, setSelectedResident] = useState<string>("");
  const [selectedRoundId, setSelectedRoundId] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [searchRes, setSearchRes] = useState("");
  const [formTab, setFormTab] = useState<TabKey>("bowel");
  // Care history timeline — view any day's rounds, not just today.
  const [viewDate, setViewDate] = useState<string>(todayDate());
  const viewingToday = viewDate.split("T")[0] === todayDate().split("T")[0];
  const shiftDay = (delta: number) => { setSelectedRoundId(""); setViewDate((d) => new Date(new Date(d).getTime() + delta * 86_400_000).toISOString()); };
  // Only the Care Manager / nurse (not caregivers) may sign off a completed round.
  const canReview = clinicianRole !== "CAREGIVER";

  const resQ = useLiveQuery("residents", { tables: ["Resident"] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roundQ = useLiveQuery<any>("daily-rounds", { query: "take=200&include=resident", tables: ["DailyRound"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const resMap = useMemo(() => new Map(residents.map((r: any) => [r.id, r])), [residents]);

  const filteredResidents = useMemo(() => {
    if (!searchRes) return residents;
    const q = searchRes.toLowerCase();
    return residents.filter((r: any) => r.name?.toLowerCase().includes(q) || r.room?.toLowerCase().includes(q));
  }, [residents, searchRes]);

  const todayRounds = useMemo(() => {
    const day = viewDate.split("T")[0];
    return (roundQ.data || []).filter((r: any) => {
      const rd = new Date(r.roundDate).toISOString().split("T")[0];
      return rd === day && (!selectedResident || r.residentId === selectedResident);
    });
  }, [roundQ.data, selectedResident, viewDate]);

  const currentRound = useMemo(() => {
    if (selectedRoundId) return (roundQ.data || []).find((r: any) => r.id === selectedRoundId);
    return todayRounds[0] || null;
  }, [roundQ.data, selectedRoundId, todayRounds]);

  const currentRoundId = String(currentRound?.id ?? "");

  const bowQ = useLiveQuery("bowel-records", { query: `take=200&f_dailyRoundId=${currentRoundId}`, tables: ["BowelRecord"] });
  const uriQ = useLiveQuery("urine-records", { query: `take=200&f_dailyRoundId=${currentRoundId}`, tables: ["UrineRecord"] });
  const edeQ = useLiveQuery("edema-records", { query: `take=200&f_dailyRoundId=${currentRoundId}`, tables: ["EdemaRecord"] });
  const conQ = useLiveQuery("concern-records", { query: `take=200&f_dailyRoundId=${currentRoundId}`, tables: ["ConcernRecord"] });
  const painRecQ = useLiveQuery("pain-records", { query: `take=200&f_dailyRoundId=${currentRoundId}`, tables: ["PainRecord"] });
  const moodQ = useLiveQuery("mood-records", { query: `take=200&f_dailyRoundId=${currentRoundId}`, tables: ["MoodRecord"] });
  const sleepQ = useLiveQuery("round-sleep-records", { query: `take=10&f_dailyRoundId=${currentRoundId}`, tables: ["SleepRecord"] });
  const mobQ = useLiveQuery("mobility-records", { query: `take=200&f_dailyRoundId=${currentRoundId}`, tables: ["MobilityRecord"] });
  const mealQ = useLiveQuery("meal-records", { query: `take=200&f_dailyRoundId=${currentRoundId}`, tables: ["MealRecord"] });
  const vitQ = useLiveQuery("vital-signs", { query: `take=200&f_dailyRoundId=${currentRoundId}`, tables: ["VitalSigns"] });

  const allQueries: Record<TabKey, { data: any[]; refetch: () => Promise<void> }> = {
    bowel: bowQ, urine: uriQ, edema: edeQ, concerns: conQ, pain: painRecQ,
    mood: moodQ, sleep: sleepQ, mobility: mobQ, meals: mealQ, vitals: vitQ,
  };

  const getTabRows = useCallback(() => (allQueries[tab]?.data || []), [tab, allQueries]);

  const refetchTab = useCallback(() => { allQueries[tab]?.refetch(); }, [tab, allQueries]);

  const handleCreateRound = async (resId: string, shift: string) => {
    // Guard against firing before a resident is chosen (e.g. the residents list
    // is still loading, so the picker was skipped and selectedResident is ""):
    // an empty residentId would hit the DB as a raw foreign-key violation.
    if (!resId) {
      Swal.fire({ title: "Select a resident", text: "Choose a resident before starting a round.", icon: "info", timer: 1800, showConfirmButton: false });
      return;
    }
    const round = await createRecord("daily-rounds", {
      residentId: resId,
      caregiverId: clinicianId,
      caregiverName: clinicianName,
      shift,
      roundDate: todayDate(),
      status: "IN_PROGRESS",
    });
    await roundQ.refetch();
    setSelectedRoundId(round.id);
    setSelectedResident(resId);
    return round;
  };

  const handleCompleteRound = async () => {
    if (!currentRoundId) return;
    await updateRecord("daily-rounds", currentRoundId, { status: "COMPLETED", endTime: timeNow() });
    await roundQ.refetch();
    Swal.fire({ title: "Round Completed", icon: "success", timer: 1500, showConfirmButton: false });
  };

  const handleMarkReviewed = async () => {
    if (!currentRoundId) return;
    // DailyRound has no reviewer columns — the REVIEWED status is the sign-off.
    await updateRecord("daily-rounds", currentRoundId, { status: "REVIEWED" });
    await roundQ.refetch();
    Swal.fire({ title: "Round Reviewed", text: "Signed off by the Care Manager.", icon: "success", timer: 1500, showConfirmButton: false });
  };

  const handleDeleteRecord = async (model: string, id: string) => {
    const result = await Swal.fire({ title: "Delete?", text: "This cannot be undone.", icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" });
    if (result.isConfirmed) {
      await deleteRecord(model, id);
      refetchTab();
    }
  };

  if (!selectedResident) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-emerald-600" />
            Daily Rounds
          </h2>
          <span className="text-sm text-gray-500">{clinicianName}</span>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={searchRes}
              onChange={(e) => setSearchRes(e.target.value)}
              placeholder="Search resident name or room..."
              className={inputCls + " pl-10"}
            />
          </div>
          {residents.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-500">
              {resQ.loading ? "Loading residents…" : "No residents found for this community."}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredResidents.map((r: any) => {
              const existingRound = todayRounds.find((tr: any) => tr.residentId === r.id);
              return (
                <button
                  key={r.id}
                  onClick={async () => {
                    setSelectedResident(r.id);
                    if (existingRound) setSelectedRoundId(existingRound.id);
                  }}
                  className="text-left p-4 border-2 rounded-xl hover:border-emerald-400 hover:bg-emerald-50 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{r.name}</p>
                      <p className="text-xs text-gray-500">Room {r.room}</p>
                    </div>
                    {existingRound ? (
                      <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-gray-100 text-gray-500 rounded-full text-xs font-medium">No Round</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <button onClick={() => { setSelectedResident(""); setSelectedRoundId(""); }} className="text-gray-500 hover:text-gray-700 text-sm">
            ← Back
          </button>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-emerald-600" />
            {resMap.get(selectedResident)?.name || "Resident"}
          </h2>
          <span className="text-xs text-gray-400">Room {resMap.get(selectedResident)?.room}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Care history timeline — navigate to any day's rounds */}
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1 py-0.5">
            <button onClick={() => shiftDay(-1)} title="Previous day" className="p-1 rounded hover:bg-gray-100 text-gray-500"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-xs font-semibold text-gray-700 px-1 min-w-[92px] text-center">{new Date(viewDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
            <button onClick={() => shiftDay(1)} disabled={viewingToday} title="Next day" className="p-1 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
            {!viewingToday && <button onClick={() => { setSelectedRoundId(""); setViewDate(todayDate()); }} className="text-[11px] font-semibold text-emerald-600 px-1.5 hover:underline">Today</button>}
          </div>
          {currentRound && (
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
              currentRound.status === "COMPLETED" ? "bg-green-100 text-green-700" :
              currentRound.status === "REVIEWED" ? "bg-blue-100 text-blue-700" :
              "bg-yellow-100 text-yellow-700"
            }`}>
              {currentRound.status.replace("_", " ")}
            </span>
          )}
          {currentRound && currentRound.status !== "COMPLETED" && currentRound.status !== "REVIEWED" && (
            <button onClick={handleCompleteRound} className={btnPrimary + " flex items-center gap-1"}>
              <CheckCircle2 className="w-4 h-4" /> Complete Round
            </button>
          )}
          {currentRound && currentRound.status === "COMPLETED" && canReview && (
            <button onClick={handleMarkReviewed} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm transition-colors flex items-center gap-1">
              <ClipboardList className="w-4 h-4" /> Mark Reviewed
            </button>
          )}
        </div>
      </div>

      {/* Documentation completion score (Module 06 — 100% completion tracked) */}
      {currentRoundId && (() => {
        const done = TABS.filter((t) => (allQueries[t.key]?.data || []).length > 0).length;
        const pct = Math.round((done / TABS.length) * 100);
        return (
          <div className="bg-white rounded-xl border p-3 flex items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-600">Documentation completeness</span>
                <span className={`text-xs font-bold ${pct === 100 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-red-600"}`}>{done}/{TABS.length} domains · {pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${pct === 100 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-400"}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        );
      })()}

      {!currentRoundId && (
        <div className="bg-white rounded-xl border p-6 text-center">
          <p className="text-gray-500 mb-4">{viewingToday ? "No active round for today." : "No round recorded for this day."}</p>
          {viewingToday && (
            <div className="flex justify-center gap-3 flex-wrap">
              {(["DAY", "EVENING", "NIGHT"] as const).map((s) => (
                <button key={s} onClick={() => handleCreateRound(selectedResident, s)} className={btnPrimary}>
                  <Plus className="w-4 h-4 inline mr-1" /> Start {s} Round
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {currentRoundId && (
        <>
          <div className="flex gap-1 overflow-x-auto pb-1 bg-white rounded-xl border p-1">
            {TABS.map((t) => {
              const count = (allQueries[t.key]?.data || []).length;
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => { setTab(t.key); setFormTab(t.key); }}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    tab === t.key ? "bg-emerald-600 text-white shadow" : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${tab === t.key ? "text-white" : t.color}`} />
                  {t.label}
                  {count > 0 ? (
                    <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      tab === t.key ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700"
                    }`}>{count}</span>
                  ) : (
                    // Empty domain — flagged so incomplete documentation is obvious.
                    <span className={`ml-1 w-1.5 h-1.5 rounded-full ${tab === t.key ? "bg-white/60" : "bg-amber-400"}`} title="Not documented yet" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-800">{TABS.find(t => t.key === tab)?.label} Observations</h3>
              <div className="flex gap-2">
                <button onClick={refetchTab} className={btnSecondary}><RefreshCw className="w-3.5 h-3.5 inline mr-1" /> Refresh</button>
                <button onClick={() => setShowForm(!showForm)} className={btnPrimary}><Plus className="w-4 h-4 inline mr-1" /> Add</button>
              </div>
            </div>

            {showForm && <FormPanel tab={formTab} roundId={currentRoundId} clinicianName={clinicianName} onDone={() => { setShowForm(false); refetchTab(); }} />}

            <TabContent tab={tab} rows={getTabRows()} onDelete={(id: string) => handleDeleteRecord(getModelSlug(tab), id)} />
          </div>
        </>
      )}
    </div>
  );
}

function getModelSlug(tab: TabKey): string {
  const map: Record<TabKey, string> = {
    bowel: "bowel-records", urine: "urine-records", edema: "edema-records",
    concerns: "concern-records", pain: "pain-records", mood: "mood-records",
    sleep: "round-sleep-records", mobility: "mobility-records", meals: "meal-records",
    vitals: "vital-signs",
  };
  return map[tab];
}

function getCreateModel(tab: TabKey): string {
  return getModelSlug(tab);
}

function FormPanel({ tab, roundId, clinicianName, onDone }: { tab: TabKey; roundId: string; clinicianName: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const now = timeNow();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    try {
      const fd = new FormData(e.currentTarget);
      const data: Record<string, any> = { dailyRoundId: roundId, time: now };

      if (tab === "bowel") {
        data.bristolType = Number(fd.get("bristolType")) || null;
        data.consistency = fd.get("consistency") || null;
        data.color = fd.get("color") || null;
        data.amount = fd.get("amount") || null;
        data.hasMucus = fd.get("hasMucus") === "on";
        data.hasBlood = fd.get("hasBlood") === "on";
        data.containment = fd.get("containment") || null;
        data.notes = fd.get("notes") || null;
      } else if (tab === "urine") {
        data.color = fd.get("color") || null;
        data.clarity = fd.get("clarity") || null;
        data.volume = fd.get("volume") || null;
        data.estimatedMl = Number(fd.get("estimatedMl")) || null;
        data.hasBlood = fd.get("hasBlood") === "on";
        data.containment = fd.get("containment") || null;
        data.outputMl = Number(fd.get("outputMl")) || null;
        data.notes = fd.get("notes") || null;
      } else if (tab === "edema") {
        data.location = fd.get("location") || "";
        data.severity = fd.get("severity") || "NONE";
        data.pitting = fd.get("pitting") === "on";
        data.skinColor = fd.get("skinColor") || null;
        data.skinTemperature = fd.get("skinTemperature") || null;
        data.notes = fd.get("notes") || null;
      } else if (tab === "concerns") {
        data.category = fd.get("category") || "PHYSICAL";
        data.description = fd.get("description") || "";
        data.severity = fd.get("severity") || "LOW";
        data.actionTaken = fd.get("actionTaken") || null;
        data.escalatedTo = fd.get("escalatedTo") || null;
      } else if (tab === "pain") {
        data.location = fd.get("location") || "";
        data.score = Number(fd.get("score")) || 0;
        data.type = fd.get("type") || null;
        data.duration = fd.get("duration") || null;
        data.triggers = fd.get("triggers") || null;
        data.reliefActions = fd.get("reliefActions") || null;
        data.medicationGiven = fd.get("medicationGiven") || null;
        data.notes = fd.get("notes") || null;
      } else if (tab === "mood") {
        data.mood = fd.get("mood") || "CALM";
        data.behaviorNotes = fd.get("behaviorNotes") || null;
        data.socialEngagement = fd.get("socialEngagement") || null;
        data.cooperation = fd.get("cooperation") || null;
        data.communication = fd.get("communication") || null;
        data.triggers = fd.get("triggers") || null;
        data.interventions = fd.get("interventions") || null;
        data.notes = fd.get("notes") || null;
      } else if (tab === "sleep") {
        data.bedtime = fd.get("bedtime") ? new Date(String(fd.get("bedtime"))).toISOString() : null;
        data.wakeTime = fd.get("wakeTime") ? new Date(String(fd.get("wakeTime"))).toISOString() : null;
        data.totalHours = Number(fd.get("totalHours")) || null;
        data.quality = fd.get("quality") || "FAIR";
        data.interruptions = Number(fd.get("interruptions")) || 0;
        data.interruptionReason = fd.get("interruptionReason") || null;
        data.naps = Number(fd.get("naps")) || 0;
        data.medicationUsed = fd.get("medicationUsed") || null;
        data.notes = fd.get("notes") || null;
      } else if (tab === "mobility") {
        data.activityType = fd.get("activityType") || "AMBULATION";
        data.assistanceLevel = fd.get("assistanceLevel") || "INDEPENDENT";
        data.assistiveDevice = fd.get("assistiveDevice") || null;
        data.durationMinutes = Number(fd.get("durationMinutes")) || null;
        data.gaitPattern = fd.get("gaitPattern") || null;
        data.fallOccurred = fd.get("fallOccurred") === "on";
        data.transferFrom = fd.get("transferFrom") || null;
        data.transferTo = fd.get("transferTo") || null;
        data.notes = fd.get("notes") || null;
      } else if (tab === "meals") {
        data.mealType = fd.get("mealType") || "BREAKFAST";
        data.appetite = fd.get("appetite") || "GOOD";
        data.intakeLevel = fd.get("intakeLevel") || "FULL";
        data.fluidIntake = fd.get("fluidIntake") || null;
        data.fluidAmountMl = Number(fd.get("fluidAmountMl")) || null;
        data.foodRefusals = fd.get("foodRefusals") || null;
        data.textureDiet = fd.get("textureDiet") || null;
        data.supplements = fd.get("supplements") || null;
        data.feedingAssist = fd.get("feedingAssist") || null;
        data.chokingRisk = fd.get("chokingRisk") === "on";
        data.notes = fd.get("notes") || null;
      } else if (tab === "vitals") {
        data.systolic = Number(fd.get("systolic")) || null;
        data.diastolic = Number(fd.get("diastolic")) || null;
        data.heartRate = Number(fd.get("heartRate")) || null;
        data.temperature = Number(fd.get("temperature")) || null;
        data.respRate = Number(fd.get("respRate")) || null;
        data.spo2 = Number(fd.get("spo2")) || null;
        data.bloodSugarLevel = Number(fd.get("bloodSugarLevel")) || null;
        data.weight = Number(fd.get("weight")) || null;
        data.painScore = Number(fd.get("painScore")) || null;
        data.notes = fd.get("notes") || null;
      }

      await createRecord(getCreateModel(tab), data);
      onDone();
    } catch (err) {
      Swal.fire("Error", String(err), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-sm text-gray-700">Add {TABS.find(t => t.key === tab)?.label} Record</h4>
        <button type="button" onClick={onDone} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <FormFields tab={tab} />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onDone} className={btnSecondary}>Cancel</button>
        <button type="submit" disabled={loading} className={btnPrimary + " flex items-center gap-1"}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Save
        </button>
      </div>
    </form>
  );
}

function FormFields({ tab }: { tab: TabKey }) {
  const fieldCls = inputCls;
  const lblCls = labelCls;

  if (tab === "bowel") return (
    <>
      <div>
        <label className={lblCls}>Bristol Type (1-7)</label>
        <select name="bristolType" className={selectCls}><option value="">Select...</option>
          {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>Type {n}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Consistency</label>
        <select name="consistency" className={selectCls}><option value="">Select...</option>
          {["Normal","Soft","Liquid","Hard","Loose","Watery","Pellet"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Color</label>
        <select name="color" className={selectCls}><option value="">Select...</option>
          {["Brown","Yellow","Green","Black","Red","Pale","Orange"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Amount</label>
        <select name="amount" className={selectCls}><option value="">Select...</option>
          {["Large","Medium","Small","Minimal"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Containment</label>
        <select name="containment" className={selectCls}><option value="">Select...</option>
          {["Continent","Incontinent","Assisted","Brief"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-4 pt-5">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="hasMucus" className="rounded" /> Mucus</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="hasBlood" className="rounded" /> Blood</label>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={lblCls}>Notes</label>
        <textarea name="notes" rows={2} className={fieldCls + " resize-none"} />
      </div>
    </>
  );

  if (tab === "urine") return (
    <>
      <div>
        <label className={lblCls}>Color</label>
        <select name="color" className={selectCls}><option value="">Select...</option>
          {["Straw","Yellow","Amber","Orange","Red","Clear","Dark"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Clarity</label>
        <select name="clarity" className={selectCls}><option value="">Select...</option>
          {["Clear","Slightly Cloudy","Cloudy","Turbid"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Volume</label>
        <select name="volume" className={selectCls}><option value="">Select...</option>
          {["Normal","High","Low","None"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Estimated mL</label>
        <input name="estimatedMl" type="number" className={fieldCls} placeholder="e.g. 300" />
      </div>
      <div>
        <label className={lblCls}>Containment</label>
        <select name="containment" className={selectCls}><option value="">Select...</option>
          {["Continent","Incontinent","Catheter","Assisted","Brief"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Output mL</label>
        <input name="outputMl" type="number" className={fieldCls} placeholder="Measured output" />
      </div>
      <div className="flex items-center gap-4 pt-5">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="hasBlood" className="rounded" /> Blood</label>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={lblCls}>Notes</label>
        <textarea name="notes" rows={2} className={fieldCls + " resize-none"} />
      </div>
    </>
  );

  if (tab === "edema") return (
    <>
      <div>
        <label className={lblCls}>Location</label>
        <select name="location" className={selectCls} required><option value="">Select...</option>
          {["Ankles","Feet","Lower Legs","Knees","Thighs","Hands","Wrists","Arms","Face","Sacral","Periorbital"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Severity</label>
        <select name="severity" className={selectCls} required>
          {["NONE","TRACE","MILD","MODERATE","SEVERE","DEEP"].map(v => <option key={v} value={v}>{v.replace("_"," +")}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Skin Color</label>
        <select name="skinColor" className={selectCls}><option value="">Select...</option>
          {["Normal","Red","Pale","Cyanotic","Shiny"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Skin Temperature</label>
        <select name="skinTemperature" className={selectCls}><option value="">Select...</option>
          {["Normal","Warm","Cool","Hot"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-4 pt-5">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pitting" className="rounded" /> Pitting</label>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={lblCls}>Notes</label>
        <textarea name="notes" rows={2} className={fieldCls + " resize-none"} />
      </div>
    </>
  );

  if (tab === "concerns") return (
    <>
      <div>
        <label className={lblCls}>Category</label>
        <select name="category" className={selectCls} required>
          {["PHYSICAL","BEHAVIORAL","SKIN","NUTRITION","HYDRATION","MOBILITY","PAIN","SLEEP","MEDICATION","OTHER"].map(v => <option key={v} value={v}>{v.replace(/_/g," ")}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Severity</label>
        <select name="severity" className={selectCls} required>
          {["LOW","MEDIUM","HIGH","CRITICAL"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={lblCls}>Description *</label>
        <textarea name="description" rows={2} required className={fieldCls + " resize-none"} placeholder="Describe the concern..." />
      </div>
      <div>
        <label className={lblCls}>Action Taken</label>
        <input name="actionTaken" className={fieldCls} placeholder="What was done" />
      </div>
      <div>
        <label className={lblCls}>Escalated To</label>
        <input name="escalatedTo" className={fieldCls} placeholder="Staff name" />
      </div>
    </>
  );

  if (tab === "pain") return (
    <>
      <div>
        <label className={lblCls}>Location *</label>
        <input name="location" required className={fieldCls} placeholder="e.g. Lower back, Left knee" />
      </div>
      <div>
        <label className={lblCls}>Pain Score (0-10) *</label>
        <input name="score" type="number" min="0" max="10" required className={fieldCls} />
      </div>
      <div>
        <label className={lblCls}>Type</label>
        <select name="type" className={selectCls}><option value="">Select...</option>
          {["Sharp","Dull","Aching","Burning","Throbbing","Cramping","Shooting"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Duration</label>
        <select name="duration" className={selectCls}><option value="">Select...</option>
          {["Constant","Intermittent","With Movement","After Activity"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Triggers</label>
        <input name="triggers" className={fieldCls} placeholder="What makes it worse" />
      </div>
      <div>
        <label className={lblCls}>Relief Actions</label>
        <input name="reliefActions" className={fieldCls} placeholder="What helps" />
      </div>
      <div>
        <label className={lblCls}>Medication Given</label>
        <input name="medicationGiven" className={fieldCls} placeholder="Med name/dose" />
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={lblCls}>Notes</label>
        <textarea name="notes" rows={2} className={fieldCls + " resize-none"} />
      </div>
    </>
  );

  if (tab === "mood") return (
    <>
      <div>
        <label className={lblCls}>Mood *</label>
        <select name="mood" className={selectCls} required>
          {["CALM","HAPPY","SAD","ANXIOUS","AGITATED","CONFUSED","AGGRESSIVE","WITHDRAWN","COOPERATIVE","APATHETIC"].map(v => <option key={v} value={v}>{v.replace(/_/g," ")}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Social Engagement</label>
        <select name="socialEngagement" className={selectCls}><option value="">Select...</option>
          {["Engaged","Selective","Withdrawn","None"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Cooperation</label>
        <select name="cooperation" className={selectCls}><option value="">Select...</option>
          {["Cooperative","Partially Cooperative","Resistive"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Communication</label>
        <select name="communication" className={selectCls}><option value="">Select...</option>
          {["Verbal","Nonverbal","Limited","None"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Triggers</label>
        <input name="triggers" className={fieldCls} placeholder="What triggered this mood" />
      </div>
      <div>
        <label className={lblCls}>Interventions</label>
        <input name="interventions" className={fieldCls} placeholder="What was done" />
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={lblCls}>Behavior Notes</label>
        <textarea name="behaviorNotes" rows={2} className={fieldCls + " resize-none"} />
      </div>
    </>
  );

  if (tab === "sleep") return (
    <>
      <div>
        <label className={lblCls}>Bedtime</label>
        <input name="bedtime" type="datetime-local" className={fieldCls} />
      </div>
      <div>
        <label className={lblCls}>Wake Time</label>
        <input name="wakeTime" type="datetime-local" className={fieldCls} />
      </div>
      <div>
        <label className={lblCls}>Total Hours</label>
        <input name="totalHours" type="number" step="0.5" className={fieldCls} placeholder="e.g. 7.5" />
      </div>
      <div>
        <label className={lblCls}>Quality *</label>
        <select name="quality" className={selectCls} required>
          {["RESTFUL","FAIR","POOR","RESTLESS","INSOMNIA"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Interruptions</label>
        <input name="interruptions" type="number" min="0" className={fieldCls} placeholder="Number of times" />
      </div>
      <div>
        <label className={lblCls}>Interruption Reason</label>
        <input name="interruptionReason" className={fieldCls} placeholder="e.g. Pain, Bathroom" />
      </div>
      <div>
        <label className={lblCls}>Naps Taken</label>
        <input name="naps" type="number" min="0" className={fieldCls} />
      </div>
      <div>
        <label className={lblCls}>Positional Changes</label>
        <select name="positionalChanges" className={selectCls}><option value="">Select...</option>
          {["Frequent","Occasional","None"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={lblCls}>Notes</label>
        <textarea name="notes" rows={2} className={fieldCls + " resize-none"} />
      </div>
    </>
  );

  if (tab === "mobility") return (
    <>
      <div>
        <label className={lblCls}>Activity Type *</label>
        <select name="activityType" className={selectCls} required>
          {["AMBULATION","TRANSFER","BED_REPOSITIONING","STANDING","WHEELCHAIR","EXERCISE","TOILETING"].map(v => <option key={v} value={v}>{v.replace(/_/g," ")}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Assistance Level *</label>
        <select name="assistanceLevel" className={selectCls} required>
          {["INDEPENDENT","SUPERVISED","MINIMAL","MODERATE","MAXIMAL","DEPENDENT"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Assistive Device</label>
        <select name="assistiveDevice" className={selectCls}><option value="">None</option>
          {["Walker","Wheelchair","Cane","Rollator","Transfer Belt","Gait Belt"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Duration (min)</label>
        <input name="durationMinutes" type="number" className={fieldCls} placeholder="Minutes" />
      </div>
      <div>
        <label className={lblCls}>Gait Pattern</label>
        <select name="gaitPattern" className={selectCls}><option value="">Select...</option>
          {["Normal","Antalgic","Shuffling","Unsteady","Festinating","Wide-based"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Transfer From</label>
        <select name="transferFrom" className={selectCls}><option value="">N/A</option>
          {["Bed","Chair","Wheelchair","Toilet","Standing","Shower"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Transfer To</label>
        <select name="transferTo" className={selectCls}><option value="">N/A</option>
          {["Bed","Chair","Wheelchair","Toilet","Standing","Shower"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-4 pt-5">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="fallOccurred" className="rounded" /> Fall Occurred</label>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={lblCls}>Notes</label>
        <textarea name="notes" rows={2} className={fieldCls + " resize-none"} />
      </div>
    </>
  );

  if (tab === "meals") return (
    <>
      <div>
        <label className={lblCls}>Meal Type *</label>
        <select name="mealType" className={selectCls} required>
          {["BREAKFAST","LUNCH","DINNER","SNACK"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Appetite *</label>
        <select name="appetite" className={selectCls} required>
          {["GOOD","FAIR","POOR","REFUSED","NPO"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Intake Level *</label>
        <select name="intakeLevel" className={selectCls} required>
          {["FULL","THREE_QUARTERS","HALF","ONE_QUARTER","NONE"].map(v => <option key={v} value={v}>{v.replace(/_/g," ")}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Fluid Intake</label>
        <select name="fluidIntake" className={selectCls}><option value="">Select...</option>
          {["None","Sips","Small","Moderate","Large"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Fluid Amount (mL)</label>
        <input name="fluidAmountMl" type="number" className={fieldCls} placeholder="e.g. 240" />
      </div>
      <div>
        <label className={lblCls}>Texture / Diet</label>
        <select name="textureDiet" className={selectCls}><option value="">Regular</option>
          {["Regular","Mechanical Soft","Pureed","Liquid","Thickened"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Supplements</label>
        <input name="supplements" className={fieldCls} placeholder="e.g. Protein shake" />
      </div>
      <div>
        <label className={lblCls}>Feeding Assistance</label>
        <select name="feedingAssist" className={selectCls}><option value="">Select...</option>
          {["Independent","Setup","Partial","Full"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className={lblCls}>Food Refusals</label>
        <input name="foodRefusals" className={fieldCls} placeholder="What was refused" />
      </div>
      <div className="flex items-center gap-4 pt-5">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="chokingRisk" className="rounded" /> Choking Risk</label>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={lblCls}>Notes</label>
        <textarea name="notes" rows={2} className={fieldCls + " resize-none"} />
      </div>
    </>
  );

  if (tab === "vitals") return (
    <>
      <div>
        <label className={lblCls}>Systolic BP</label>
        <input name="systolic" type="number" className={fieldCls} placeholder="mmHg" />
      </div>
      <div>
        <label className={lblCls}>Diastolic BP</label>
        <input name="diastolic" type="number" className={fieldCls} placeholder="mmHg" />
      </div>
      <div>
        <label className={lblCls}>Heart Rate</label>
        <input name="heartRate" type="number" className={fieldCls} placeholder="bpm" />
      </div>
      <div>
        <label className={lblCls}>Temperature (°F)</label>
        <input name="temperature" type="number" step="0.1" className={fieldCls} placeholder="98.6" />
      </div>
      <div>
        <label className={lblCls}>Resp Rate</label>
        <input name="respRate" type="number" className={fieldCls} placeholder="breaths/min" />
      </div>
      <div>
        <label className={lblCls}>SpO2 (%)</label>
        <input name="spo2" type="number" className={fieldCls} placeholder="99" />
      </div>
      <div>
        <label className={lblCls}>Blood Sugar (mg/dL)</label>
        <input name="bloodSugarLevel" type="number" className={fieldCls} placeholder="120" />
      </div>
      <div>
        <label className={lblCls}>Weight (lbs)</label>
        <input name="weight" type="number" step="0.1" className={fieldCls} />
      </div>
      <div>
        <label className={lblCls}>Pain Score (0-10)</label>
        <input name="painScore" type="number" min="0" max="10" className={fieldCls} />
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={lblCls}>Notes</label>
        <textarea name="notes" rows={2} className={fieldCls + " resize-none"} />
      </div>
    </>
  );

  return null;
}

function TabContent({ tab, rows, onDelete }: { tab: TabKey; rows: any[]; onDelete: (id: string) => void }) {
  if (!rows.length) {
    return (
      <div className="py-12 text-center text-gray-400">
        <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No records yet. Click + Add to document.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[500px] overflow-y-auto">
      {rows.map((r: any) => (
        <div key={r.id} className="p-3 bg-gray-50 rounded-lg border flex items-start justify-between gap-3 hover:bg-gray-100 transition-colors">
          <div className="flex-1 min-w-0">
            {tab === "bowel" && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-medium text-sm">{r.bristolType ? `Type ${r.bristolType}` : ""} {r.consistency}</span>
                <span className="text-xs text-gray-500">{r.color} · {r.amount}</span>
                {r.hasBlood && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-bold">BLOOD</span>}
                {r.hasMucus && <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-[10px] font-bold">MUCUS</span>}
                <span className="text-xs text-gray-400">{r.containment}</span>
              </div>
            )}
            {tab === "urine" && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-medium text-sm">{r.color} · {r.clarity}</span>
                <span className="text-xs text-gray-500">Vol: {r.volume} {r.estimatedMl ? `(${r.estimatedMl}mL)` : ""}</span>
                {r.outputMl && <span className="text-xs text-gray-500">Output: {r.outputMl}mL</span>}
                {r.hasBlood && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-bold">BLOOD</span>}
                <span className="text-xs text-gray-400">{r.containment}</span>
              </div>
            )}
            {tab === "edema" && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-medium text-sm">{r.location}</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  r.severity === "NONE" ? "bg-green-100 text-green-700" :
                  r.severity === "MILD" ? "bg-yellow-100 text-yellow-700" :
                  r.severity === "MODERATE" ? "bg-orange-100 text-orange-700" :
                  "bg-red-100 text-red-700"
                }`}>{r.severity}</span>
                {r.pitting && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-bold">PITTING</span>}
                <span className="text-xs text-gray-500">{r.skinColor} {r.skinTemperature}</span>
              </div>
            )}
            {tab === "concerns" && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  r.severity === "LOW" ? "bg-blue-100 text-blue-700" :
                  r.severity === "MEDIUM" ? "bg-yellow-100 text-yellow-700" :
                  r.severity === "HIGH" ? "bg-orange-100 text-orange-700" :
                  "bg-red-100 text-red-700"
                }`}>{r.severity}</span>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-medium">{r.category}</span>
                <span className="text-sm text-gray-700">{r.description}</span>
                {r.actionTaken && <span className="text-xs text-green-600">→ {r.actionTaken}</span>}
                {r.escalatedTo && <span className="text-xs text-orange-600">↗ {r.escalatedTo}</span>}
              </div>
            )}
            {tab === "pain" && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-medium text-sm">{r.location}</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  r.score <= 3 ? "bg-green-100 text-green-700" :
                  r.score <= 6 ? "bg-yellow-100 text-yellow-700" :
                  "bg-red-100 text-red-700"
                }`}>Score: {r.score}/10</span>
                <span className="text-xs text-gray-500">{r.type} · {r.duration}</span>
                {r.medicationGiven && <span className="text-xs text-blue-600">💊 {r.medicationGiven}</span>}
              </div>
            )}
            {tab === "mood" && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  ["CALM","HAPPY","COOPERATIVE"].includes(r.mood) ? "bg-green-100 text-green-700" :
                  ["ANXIOUS","CONFUSED","WITHDRAWN"].includes(r.mood) ? "bg-yellow-100 text-yellow-700" :
                  "bg-red-100 text-red-700"
                }`}>{r.mood}</span>
                <span className="text-xs text-gray-500">Social: {r.socialEngagement}</span>
                <span className="text-xs text-gray-500">Coop: {r.cooperation}</span>
                <span className="text-xs text-gray-500">Comm: {r.communication}</span>
                {r.behaviorNotes && <span className="text-xs text-gray-600 truncate max-w-[200px]">{r.behaviorNotes}</span>}
              </div>
            )}
            {tab === "sleep" && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  r.quality === "RESTFUL" ? "bg-green-100 text-green-700" :
                  r.quality === "FAIR" ? "bg-yellow-100 text-yellow-700" :
                  "bg-red-100 text-red-700"
                }`}>{r.quality}</span>
                <span className="text-sm font-medium">{r.totalHours ? `${r.totalHours}h` : ""}</span>
                <span className="text-xs text-gray-500">Interruptions: {r.interruptions}</span>
                {r.naps > 0 && <span className="text-xs text-gray-500">Naps: {r.naps}</span>}
                {r.medicationUsed && <span className="text-xs text-blue-600">💊 {r.medicationUsed}</span>}
              </div>
            )}
            {tab === "mobility" && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-medium text-sm">{r.activityType?.replace(/_/g," ")}</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  r.assistanceLevel === "INDEPENDENT" ? "bg-green-100 text-green-700" :
                  ["SUPERVISED","MINIMAL"].includes(r.assistanceLevel) ? "bg-yellow-100 text-yellow-700" :
                  "bg-red-100 text-red-700"
                }`}>{r.assistanceLevel}</span>
                {r.assistiveDevice && <span className="text-xs text-gray-500">🔧 {r.assistiveDevice}</span>}
                {r.fallOccurred && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-bold">FALL</span>}
                {r.durationMinutes && <span className="text-xs text-gray-400">{r.durationMinutes}min</span>}
              </div>
            )}
            {tab === "meals" && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-bold">{r.mealType}</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  r.appetite === "GOOD" ? "bg-green-100 text-green-700" :
                  r.appetite === "FAIR" ? "bg-yellow-100 text-yellow-700" :
                  "bg-red-100 text-red-700"
                }`}>{r.appetite}</span>
                <span className="text-sm font-medium">Intake: {r.intakeLevel?.replace(/_/g," ")}</span>
                {r.fluidIntake && <span className="text-xs text-blue-600">💧 {r.fluidIntake} {r.fluidAmountMl ? `(${r.fluidAmountMl}mL)` : ""}</span>}
                {r.chokingRisk && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-bold">CHOKING RISK</span>}
                {r.foodRefusals && <span className="text-xs text-orange-600">Refused: {r.foodRefusals}</span>}
              </div>
            )}
            {tab === "vitals" && (
              <div className="flex items-center gap-3 flex-wrap text-sm">
                {r.systolic && r.diastolic && <span className="font-medium">BP: {r.systolic}/{r.diastolic}</span>}
                {r.heartRate && <span>HR: {r.heartRate}</span>}
                {r.temperature && <span>Temp: {r.temperature}°{r.temperatureUnit || "F"}</span>}
                {r.spo2 && <span>SpO2: {r.spo2}%</span>}
                {r.respRate && <span>RR: {r.respRate}</span>}
                {r.bloodSugarLevel && <span>BSL: {r.bloodSugarLevel}</span>}
                {r.weight && <span>Wt: {r.weight}{r.weightUnit || "lbs"}</span>}
                {r.painScore != null && <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.painScore <= 3 ? "bg-green-100 text-green-700" : r.painScore <= 6 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>Pain: {r.painScore}/10</span>}
              </div>
            )}
            {r.notes && <p className="text-xs text-gray-500 mt-1">{r.notes}</p>}
            <p className="text-[10px] text-gray-400 mt-1">{new Date(r.time || r.createdAt).toLocaleString()}</p>
          </div>
          <button onClick={() => onDelete(r.id)} className="text-red-400 hover:text-red-600 p-1 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}
    </div>
  );
}
