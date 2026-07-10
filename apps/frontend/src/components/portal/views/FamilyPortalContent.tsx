"use client";

import StatCard from "@/components/portal/widgets/StatCard";
import ChartContainer from "@/components/portal/widgets/ChartContainer";
import VitalsPanel, { VitalReading } from "@/components/portal/widgets/VitalsPanel";
import CameraVisionFeed from "@/components/CameraVisionFeed";
import {
  DollarSign, Heart, Activity, HeartPulse, MessageSquare, Calendar,
  ChevronRight, AlertTriangle, Droplets, Wind, Thermometer, Pill,
  Clock, Phone, Plus, X, Search, CheckCircle2, RefreshCw, Send, Mail,
  Receipt, Wallet, FileText, CreditCard, Printer,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import Swal from "sweetalert2";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";
import { adaptResident, adaptIncident, humanize, adaptInvoice, adaptServiceCharge, adaptInsuranceValidation, adaptPayment } from "@/lib/adapters";

interface FamilyPortalContentProps {
  tab: string;
}

type Invoice = ReturnType<typeof adaptInvoice>;
type ServiceCharge = ReturnType<typeof adaptServiceCharge>;
type InsuranceValidation = ReturnType<typeof adaptInsuranceValidation>;
type Payment = ReturnType<typeof adaptPayment>;

/** Small inline loading indicator shown while a tab's query is fetching. */
function TabLoading({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-10 text-gray-500">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** Friendly empty state for tabs with no rows. */
function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
      {message}
    </div>
  );
}

export default function FamilyPortalContent({ tab }: FamilyPortalContentProps) {
  // ---- Live data (all hooks run unconditionally, before any tab return) ----
  // Live monitoring (relative tab) fall-detection state.
  const [relFallAlert, setRelFallAlert] = useState(false);
  const [relFallSummary, setRelFallSummary] = useState("");

  // Current time in state — reading the clock during render is impure.
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  // My Relative: first resident with incidents + medications included.
  const {
    data: residentRows,
    loading: residentLoading,
  } = useLiveQuery("residents", {
    query: "include=incidents,medications&take=1",
    tables: ["Resident"],
  });
  const relative = useMemo(
    () => (residentRows.length ? adaptResident(residentRows[0]) : null),
    [residentRows]
  );

  // Health Timeline: recent vitals.
  const {
    data: vitalsRows,
    loading: vitalsLoading,
  } = useLiveQuery("vitals", {
    query: "include=resident&take=50",
    tables: ["VitalsLog"],
  });

  // Alerts: recent incidents.
  const {
    data: incidentRows,
    loading: incidentLoading,
    refetch: refetchIncidents,
  } = useLiveQuery("incidents", {
    query: "include=resident&take=50",
    tables: ["Incident"],
  });

  // Billing filters.
  const [billView, setBillView] = useState<"list" | "analytics">("list");
  const [invStatus, setInvStatus] = useState<string>("all");
  const [invSearch, setInvSearch] = useState("");

  // Alerts filters.
  const [alertSeverity, setAlertSeverity] = useState<string>("all");
  const [alertStatus, setAlertStatus] = useState<string>("all");
  const [alertSearch, setAlertSearch] = useState("");
  const incidents = useMemo(
    () => incidentRows.map(adaptIncident),
    [incidentRows]
  );

  // Messages.
  const {
    data: messageRows,
    loading: messageLoading,
    refetch: refetchMessages,
  } = useLiveQuery("messages", {
    query: "include=sender&take=100",
    tables: ["Message"],
  });

  // Compose / message filters.
  const [showCompose, setShowCompose] = useState(false);
  const [sendingMsg, setSendingMsg] = useState(false);
  const [msgStatus, setMsgStatus] = useState<"all" | "unread">("all");
  const [msgType, setMsgType] = useState<string>("all");
  const [msgSearch, setMsgSearch] = useState("");
  const [composeForm, setComposeForm] = useState({ subject: "", content: "", messageType: "GENERAL" });

  // Billing / invoices.
  const {
    data: invoiceRows,
    loading: invoiceLoading,
    refetch: refetchInvoices,
  } = useLiveQuery("invoices", {
    query: "include=resident,serviceCharges,payments&take=100",
    tables: ["Invoice", "Resident", "ServiceCharge", "Payment"],
  });

  const {
    data: chargeRows,
    loading: chargeLoading,
    refetch: refetchCharges,
  } = useLiveQuery("service-charges", {
    query: "include=resident,invoice&take=100",
    tables: ["ServiceCharge", "Resident", "Invoice"],
  });

  const {
    data: insuranceRows,
    loading: insuranceLoading,
    refetch: refetchInsurance,
  } = useLiveQuery("insurance-validations", {
    query: "include=resident&take=100",
    tables: ["InsuranceValidation", "Resident"],
  });

  const {
    data: paymentRows,
    loading: paymentLoading,
    refetch: refetchPayments,
  } = useLiveQuery("payments", {
    query: "include=invoice&take=100",
    tables: ["Payment", "Invoice"],
  });

  // Billing view and states
  const [billSubTab, setBillSubTab] = useState<"invoices" | "charges" | "insurance">("invoices");
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [viewingReceipt, setViewingReceipt] = useState<Payment | any | null>(null);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [payForm, setPayForm] = useState({ cardName: "", cardNumber: "", cardExpiry: "", cardCvv: "" });

  // Appointments / visits.
  const {
    data: visitRows,
    loading: visitLoading,
    refetch: refetchVisits,
  } = useLiveQuery("visits", {
    query: "take=100",
    tables: ["Visit"],
  });

  // Visit request form state.
  const [showVisitForm, setShowVisitForm] = useState(false);
  const [savingVisit, setSavingVisit] = useState(false);
  const [visitFilter, setVisitFilter] = useState<"all" | "upcoming" | "past">("all");
  const [visitSearch, setVisitSearch] = useState("");
  const [visitForm, setVisitForm] = useState({ visitorName: "", relationship: "", purpose: "", date: "", phone: "", notes: "" });

  // Live vitals panel readings derived from the latest of each vital type.
  const liveVitals = useMemo<VitalReading[]>(() => {
    const wanted: VitalReading["type"][] = [
      "HEART_RATE",
      "TEMPERATURE",
      "BLOOD_PRESSURE",
      "OXYGEN",
    ];
    const unitFor: Record<string, string> = {
      HEART_RATE: "bpm",
      TEMPERATURE: "°C",
      BLOOD_PRESSURE: "mmHg",
      OXYGEN: "%",
    };
    const readings: VitalReading[] = [];
    for (const type of wanted) {
      const row = vitalsRows.find(
        (v: Record<string, unknown>) => v.type === type
      );
      if (!row) continue;
      const numeric = parseFloat(String(row.value));
      readings.push({
        type,
        value: isNaN(numeric) ? 0 : numeric,
        unit: (row.unit as string) ?? unitFor[type] ?? "",
        normal: true,
        lastUpdated: row.recordedAt
          ? new Date(row.recordedAt as string)
          : new Date(),
      });
    }
    return readings;
  }, [vitalsRows]);

  // Heart-rate trend for the timeline/dashboard chart (real data if present).
  const heartRateTrend = useMemo(() => {
    const points = vitalsRows
      .filter((v: Record<string, unknown>) => v.type === "HEART_RATE")
      .slice(0, 12)
      .reverse()
      .map((v: Record<string, unknown>) => {
        const numeric = parseFloat(String(v.value));
        return {
          name: v.recordedAt
            ? new Date(v.recordedAt as string).toLocaleDateString([], {
                month: "short",
                day: "numeric",
              })
            : "",
          value: isNaN(numeric) ? 0 : numeric,
        };
      });
    return points;
  }, [vitalsRows]);

  const mockVitalsData = [
    { name: "Mon", value: 74 },
    { name: "Tue", value: 76 },
    { name: "Wed", value: 75 },
    { name: "Thu", value: 77 },
    { name: "Fri", value: 75 },
    { name: "Sat", value: 73 },
  ];

  const relativeDisplayName = relative?.name ?? "your relative";

  // ---------------------------------------------------------------- My Relative
  if (tab === "relative") {
    if (residentLoading && residentRows.length === 0) {
      return <div className="space-y-6"><h2 className="text-2xl font-bold text-gray-900">My Relative</h2><TabLoading label="Loading relative..." /></div>;
    }
    if (!relative) {
      return <div className="space-y-6"><h2 className="text-2xl font-bold text-gray-900">My Relative</h2><EmptyState message="No resident record is linked yet." /></div>;
    }

    const rawMeds = (relative.raw?.medications ?? []) as Array<Record<string, unknown>>;
    const rawIncidents = (relative.raw?.incidents ?? []) as Array<Record<string, unknown>>;
    const conditions = relative.medicalHistory ? relative.medicalHistory.split(",").map((c) => c.trim()).filter(Boolean) : [];

    // This relative's vitals (match by residentId or room), latest of each type.
    const relVitals = vitalsRows.filter((v: Record<string, unknown>) => {
      const res = v.resident as { roomNumber?: string } | undefined;
      return v.residentId === relative.id || res?.roomNumber === relative.room;
    });
    const latestOf = (type: string) => {
      let best: Record<string, unknown> | undefined;
      for (const v of relVitals) {
        if (v.type !== type) continue;
        if (!best || new Date(String(v.recordedAt)) > new Date(String(best.recordedAt))) best = v;
      }
      return best;
    };
    const VITALS = [
      { key: "HEART_RATE", label: "Heart Rate", icon: Heart, color: "text-red-500" },
      { key: "BLOOD_PRESSURE", label: "Blood Pressure", icon: Droplets, color: "text-blue-500" },
      { key: "TEMPERATURE", label: "Temperature", icon: Thermometer, color: "text-orange-500" },
      { key: "OXYGEN", label: "Oxygen", icon: Wind, color: "text-green-500" },
    ];
    const relHrTrend = relVitals
      .filter((v) => v.type === "HEART_RATE")
      .slice(0, 12).reverse()
      .map((v) => ({ name: v.recordedAt ? new Date(String(v.recordedAt)).toLocaleDateString([], { month: "short", day: "numeric" }) : "", value: parseFloat(String(v.value)) || 0 }));
    const sevBadge = (s: string) => s === "CRITICAL" ? "bg-red-100 text-red-700" : s === "SEVERE" ? "bg-orange-100 text-orange-700" : s === "MODERATE" ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700";

    return (
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Heart className="w-6 h-6 text-red-500 flex-shrink-0" /> {relative.name}
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Room {relative.room} • {humanize(relative.careLevel)} Care{relative.age != null ? ` • Age ${relative.age}` : ""}
            {relative.alertsCount > 0 && (
              <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs font-semibold ml-1">{relative.alertsCount} alert{relative.alertsCount === 1 ? "" : "s"}</span>
            )}
          </p>
        </div>

        {/* Live Monitoring */}
        <div>
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-blue-500" /> Live Monitoring</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2">
              <div className="relative w-full aspect-[4/3] md:aspect-video bg-black rounded-2xl overflow-hidden shadow-lg border-2 border-blue-200">
                <CameraVisionFeed
                  cameraMode="hybrid"
                  isFallen={relFallAlert}
                  onFallTriggered={(a: { summary?: string }) => { setRelFallAlert(true); setRelFallSummary(a.summary || "Fall detected on camera."); }}
                  onFallCleared={() => setRelFallAlert(false)}
                />
              </div>
            </div>
            <div className="space-y-3">
              <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Monitoring Status</h4>
                {relFallAlert ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3.5">
                    <p className="text-sm font-bold text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Fall Detected</p>
                    <p className="text-xs text-red-600 mt-1">{relFallSummary}</p>
                    <p className="text-xs text-gray-500 mt-2">Care staff have been alerted. {relative.name} is in Room {relative.room}.</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-xs font-semibold text-emerald-800 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Fall detection is monitoring normally.
                  </div>
                )}
              </div>
              <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm text-xs text-gray-500">
                <p className="flex items-center gap-2"><Activity className="w-3.5 h-3.5 text-blue-400" /> AI analyzes posture, motion &amp; emotion in real time.</p>
                <p className="mt-1.5">Live emotion &amp; behavior labels appear on the video feed.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Vitals */}
        <div>
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><HeartPulse className="w-4 h-4 text-red-500" /> Latest Vital Signs</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {VITALS.map(({ key, label, icon: Icon, color }) => {
              const v = latestOf(key);
              return (
                <div key={key} className="bg-white p-4 rounded-lg border border-gray-200">
                  <p className="text-xs text-gray-600 font-semibold flex items-center gap-1"><Icon className={`w-3.5 h-3.5 ${color}`} /> {label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{v ? String(v.value) : "—"}<span className="text-sm font-medium text-gray-500 ml-1">{v?.unit ? String(v.unit) : ""}</span></p>
                  <p className="text-xs text-gray-400 mt-0.5">{v?.recordedAt ? new Date(String(v.recordedAt)).toLocaleString() : "No reading"}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* HR trend */}
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <ChartContainer title="Heart Rate Trend" type="area" data={relHrTrend.length ? relHrTrend : mockVitalsData} dataKey="value" xAxisKey="name" colors={["#ef4444"]} height={220} />
        </div>

        {/* Medications + Conditions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Pill className="w-4 h-4 text-blue-500" /> Medications ({rawMeds.length})</h4>
            <div className="space-y-2">
              {rawMeds.length ? rawMeds.map((m, i) => (
                <div key={i} className="flex items-center justify-between gap-2 p-2 bg-blue-50 rounded border border-blue-100">
                  <span className="text-gray-900 text-sm">💊 {String(m.name ?? "")} <span className="text-gray-500">{String(m.dosage ?? "")}</span></span>
                  <span className="text-xs text-gray-600">{String(m.frequency ?? "")}</span>
                </div>
              )) : <p className="text-sm text-gray-500">No active medications recorded.</p>}
            </div>
          </div>
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-3">Conditions &amp; Allergies</h4>
            {relative.allergies && (
              <div className="mb-3 p-2 bg-red-50 border-l-4 border-red-400 rounded">
                <p className="text-xs font-semibold text-red-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Allergies</p>
                <p className="text-sm text-gray-900 mt-0.5">{relative.allergies}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {conditions.length ? conditions.map((c, i) => (
                <span key={i} className="px-2 py-1 bg-purple-50 text-purple-800 border border-purple-200 rounded text-xs font-medium">{c}</span>
              )) : <p className="text-sm text-gray-500">No chronic conditions recorded.</p>}
            </div>
          </div>
        </div>

        {/* Recent incidents */}
        {rawIncidents.length > 0 && (
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-500" /> Recent Incidents</h4>
            <div className="space-y-2">
              {rawIncidents.slice(0, 5).map((i, idx) => (
                <div key={idx} className={`p-3 rounded-lg border ${i.resolvedAt ? "bg-gray-50 border-gray-200" : "bg-red-50 border-red-100"}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-medium text-gray-900 text-sm">{humanize(String(i.incidentType ?? "")) || "Incident"}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${sevBadge(String(i.severity ?? ""))}`}>{humanize(String(i.severity ?? "")) || "—"}</span>
                  </div>
                  <p className="text-xs text-gray-600">{String(i.description ?? "")}</p>
                  <p className="text-xs text-gray-400 mt-1">{i.incidentDate ? new Date(String(i.incidentDate)).toLocaleString() : "—"} • {i.resolvedAt ? "Resolved" : "Open"}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Care notes */}
        {relative.notes && (
          <div className="bg-yellow-50 border-l-4 border-yellow-400 rounded p-6">
            <h4 className="font-semibold text-gray-900 mb-2">Care Notes</h4>
            <p className="text-gray-700 text-sm">{relative.notes}</p>
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------- Daily Report
  if (tab === "report") {
    const relVitals = vitalsRows.filter((v: Record<string, unknown>) => {
      const res = v.resident as { roomNumber?: string } | undefined;
      return v.residentId === relative?.id || (relative && res?.roomNumber === relative.room);
    });
    const rawMeds = (relative?.raw?.medications ?? []) as Array<Record<string, unknown>>;
    const rawIncidents = (relative?.raw?.incidents ?? []) as Array<Record<string, unknown>>;
    const isToday = (iso: string) => {
      if (!iso || !nowTs) return false;
      const d = new Date(iso), n = new Date(nowTs);
      return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    };
    const vitalsToday = relVitals.filter((v) => isToday(String(v.recordedAt))).length;
    const openAlerts = rawIncidents.filter((i) => !i.resolvedAt).length;

    const latestOf = (type: string) => {
      let best: Record<string, unknown> | undefined;
      for (const v of relVitals) {
        if (v.type !== type) continue;
        if (!best || new Date(String(v.recordedAt)) > new Date(String(best.recordedAt))) best = v;
      }
      return best;
    };
    const SNAPSHOT = [
      { key: "HEART_RATE", label: "Heart Rate", icon: Heart, color: "text-red-500" },
      { key: "BLOOD_PRESSURE", label: "Blood Pressure", icon: Droplets, color: "text-blue-500" },
      { key: "TEMPERATURE", label: "Temperature", icon: Thermometer, color: "text-orange-500" },
      { key: "OXYGEN", label: "Oxygen", icon: Wind, color: "text-green-500" },
    ];

    type Ev = { icon: typeof Heart; color: string; title: string; detail: string; ts: number; when: string };
    const t = (iso: unknown) => (iso ? new Date(String(iso)).getTime() : 0);
    const events: Ev[] = [
      ...relVitals.map((v) => ({ icon: HeartPulse, color: "text-red-500", title: `${humanize(String(v.type))} recorded`, detail: `${String(v.value)}${v.unit ? ` ${String(v.unit)}` : ""}`, ts: t(v.recordedAt), when: v.recordedAt ? new Date(String(v.recordedAt)).toLocaleString() : "" })),
      ...rawIncidents.map((i) => ({ icon: AlertTriangle, color: "text-orange-500", title: humanize(String(i.incidentType ?? "")) || "Incident", detail: String(i.description ?? ""), ts: t(i.incidentDate), when: i.incidentDate ? new Date(String(i.incidentDate)).toLocaleString() : "" })),
      ...visitRows.map((v: Record<string, unknown>) => ({ icon: Calendar, color: "text-purple-500", title: `Visit — ${String(v.visitorName ?? "Guest")}`, detail: String(v.purpose ?? ""), ts: t(v.checkInTime), when: v.checkInTime ? new Date(String(v.checkInTime)).toLocaleString() : "" })),
      ...messageRows.map((m: Record<string, unknown>) => ({ icon: MessageSquare, color: "text-blue-500", title: String(m.subject ?? humanize(String(m.messageType ?? ""))) || "Message", detail: String(m.content ?? ""), ts: t(m.createdAt), when: m.createdAt ? new Date(String(m.createdAt)).toLocaleString() : "" })),
    ].filter((e) => e.ts > 0).sort((a, b) => b.ts - a.ts).slice(0, 10);

    return (
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Activity className="w-6 h-6 text-yellow-500 flex-shrink-0" /> Daily Report
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            {relativeDisplayName} • {nowTs ? new Date(nowTs).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "—"}
          </p>
        </div>

        {/* Live summary sentence */}
        <div className="bg-gradient-to-br from-green-50 to-blue-50 border border-green-200 rounded-lg p-5">
          <p className="text-gray-800">
            {relativeDisplayName} has <span className="font-bold">{vitalsToday}</span> vital reading{vitalsToday === 1 ? "" : "s"} logged today,
            {" "}<span className="font-bold">{rawMeds.length}</span> active medication{rawMeds.length === 1 ? "" : "s"}, and
            {" "}{openAlerts > 0 ? <span className="font-bold text-red-600">{openAlerts} open alert{openAlerts === 1 ? "" : "s"}</span> : <span className="font-bold text-green-600">no open alerts</span>}. {openAlerts > 0 ? "Care staff are attending." : "All is well."}
          </p>
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <ReportStat label="Vitals Today" value={vitalsToday} icon={HeartPulse} tone="rose" />
          <ReportStat label="Medications" value={rawMeds.length} icon={Pill} tone="blue" />
          <ReportStat label="Open Alerts" value={openAlerts} icon={AlertTriangle} tone={openAlerts > 0 ? "red" : "green"} />
          <ReportStat label="Total Vitals" value={relVitals.length} icon={Activity} tone="gray" />
        </div>

        {/* Vitals snapshot */}
        <div>
          <h3 className="font-semibold text-gray-900 mb-3">Vitals Snapshot</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {SNAPSHOT.map(({ key, label, icon: Icon, color }) => {
              const v = latestOf(key);
              return (
                <div key={key} className="bg-white p-4 rounded-lg border border-gray-200">
                  <p className="text-xs text-gray-600 font-semibold flex items-center gap-1"><Icon className={`w-3.5 h-3.5 ${color}`} /> {label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{v ? String(v.value) : "—"}<span className="text-sm font-medium text-gray-500 ml-1">{v?.unit ? String(v.unit) : ""}</span></p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Activity timeline */}
          <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-blue-500" /> Activity Timeline</h3>
            {events.length > 0 ? (
              <ol className="relative border-l-2 border-gray-100 ml-2 space-y-4">
                {events.map((e, i) => {
                  const Icon = e.icon;
                  return (
                    <li key={i} className="ml-4">
                      <span className="absolute -left-[9px] flex items-center justify-center w-4 h-4 bg-white rounded-full ring-2 ring-gray-100">
                        <Icon className={`w-3 h-3 ${e.color}`} />
                      </span>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 text-sm">{e.title}</p>
                          {e.detail && <p className="text-xs text-gray-600 truncate">{e.detail}</p>}
                        </div>
                        <span className="text-xs text-gray-400 flex-shrink-0">{e.when}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-sm text-gray-500 py-6 text-center">No recent activity recorded.</p>
            )}
          </div>

          {/* Medication schedule */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Pill className="w-4 h-4 text-blue-500" /> Medications</h3>
            {rawMeds.length > 0 ? (
              <div className="space-y-2">
                {rawMeds.map((m, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-blue-50 border border-blue-100">
                    <p className="font-medium text-gray-900 text-sm">💊 {String(m.name ?? "")} <span className="text-gray-500 font-normal">{String(m.dosage ?? "")}</span></p>
                    <p className="text-xs text-gray-600">{String(m.frequency ?? "")}{m.status ? ` • ${humanize(String(m.status))}` : ""}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-4 text-center">No active medications.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ Health Timeline
  if (tab === "timeline") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Health Timeline</h2>
        <ChartContainer
          title="Heart Rate (Recent)"
          type="line"
          data={heartRateTrend.length ? heartRateTrend : mockVitalsData}
          dataKey="value"
          xAxisKey="name"
          colors={["#ef4444"]}
        />

        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">Recent Vitals</h3>
          </div>
          {vitalsLoading && vitalsRows.length === 0 ? (
            <TabLoading label="Loading vitals..." />
          ) : vitalsRows.length === 0 ? (
            <EmptyState message="No vital readings recorded yet." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {vitalsRows.map((v: Record<string, unknown>, i: number) => (
                <li
                  key={(v.id as string) ?? i}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      {humanize(v.type as string)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {v.recordedAt
                        ? new Date(v.recordedAt as string).toLocaleString()
                        : ""}
                    </p>
                  </div>
                  <span className="text-lg font-semibold text-gray-900">
                    {String(v.value)}
                    {v.unit ? ` ${String(v.unit)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------- Alerts
  if (tab === "alerts") {
    // Scope to this relative when linked (family view); otherwise show all.
    const relAlerts = relative ? incidents.filter((i) => i.room === relative.room) : incidents;

    const SEV: Record<string, { label: string; badge: string; border: string; bar: string; color: string }> = {
      critical: { label: "Critical", badge: "bg-red-100 text-red-700", border: "border-l-red-500", bar: "bg-red-500", color: "text-red-500" },
      high: { label: "High", badge: "bg-orange-100 text-orange-700", border: "border-l-orange-500", bar: "bg-orange-500", color: "text-orange-500" },
      medium: { label: "Medium", badge: "bg-yellow-100 text-yellow-700", border: "border-l-yellow-500", bar: "bg-yellow-500", color: "text-yellow-600" },
      low: { label: "Low", badge: "bg-blue-100 text-blue-700", border: "border-l-blue-500", bar: "bg-blue-500", color: "text-blue-500" },
    };
    const SEV_KEYS = ["critical", "high", "medium", "low"] as const;

    const openCount = relAlerts.filter((i) => !i.resolved).length;
    const criticalCount = relAlerts.filter((i) => (i.severity === "critical" || i.severity === "high") && !i.resolved).length;
    const resolvedCount = relAlerts.filter((i) => i.resolved).length;
    const sevCounts = SEV_KEYS.map((k) => ({ key: k, count: relAlerts.filter((i) => i.severity === k).length }));
    const maxSev = Math.max(1, ...sevCounts.map((s) => s.count));

    const q = alertSearch.trim().toLowerCase();
    const filtered = relAlerts
      .filter((i) => alertSeverity === "all" || i.severity === alertSeverity)
      .filter((i) => alertStatus === "all" || (alertStatus === "open" ? !i.resolved : i.resolved))
      .filter((i) => !q || i.type.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q) || i.resident.toLowerCase().includes(q))
      .sort((a, b) => new Date(String(b.timestamp ?? 0)).getTime() - new Date(String(a.timestamp ?? 0)).getTime());

    const rel = (iso: unknown) => {
      if (!iso || !nowTs) return "";
      const m = Math.round((nowTs - new Date(String(iso)).getTime()) / 60000);
      return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
    };

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-orange-500 flex-shrink-0" /> Alerts
            </h1>
            <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
              <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
              Safety &amp; health events for {relativeDisplayName}
            </p>
          </div>
          <button onClick={() => void refetchIncidents()} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium self-start"><RefreshCw className="w-4 h-4" /> Refresh</button>
        </div>

        {/* All-clear banner */}
        {relAlerts.length > 0 && openCount === 0 && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" /> All alerts resolved — {relativeDisplayName} is stable.
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <ReportStat label="Total Alerts" value={relAlerts.length} icon={AlertTriangle} tone="gray" />
          <ReportStat label="Open" value={openCount} icon={Activity} tone={openCount > 0 ? "red" : "green"} />
          <ReportStat label="Critical / High" value={criticalCount} icon={AlertTriangle} tone={criticalCount > 0 ? "red" : "green"} />
          <ReportStat label="Resolved" value={resolvedCount} icon={CheckCircle2} tone="green" />
        </div>

        {/* Severity breakdown */}
        {relAlerts.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Severity Breakdown</h3>
            <div className="space-y-2">
              {sevCounts.map(({ key, count }) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-16 text-xs font-semibold text-gray-600">{SEV[key].label}</span>
                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${SEV[key].bar} transition-all`} style={{ width: `${(count / maxSev) * 100}%` }} />
                  </div>
                  <span className="w-6 text-sm font-bold text-gray-700 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select value={alertSeverity} onChange={(e) => setAlertSeverity(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-orange-400 outline-none">
            <option value="all">All Severities</option>
            {SEV_KEYS.map((k) => <option key={k} value={k}>{SEV[k].label}</option>)}
          </select>
          <select value={alertStatus} onChange={(e) => setAlertStatus(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-orange-400 outline-none">
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
            <input type="text" placeholder="Search alerts…" value={alertSearch} onChange={(e) => setAlertSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none" />
          </div>
        </div>

        {/* List */}
        {incidentLoading && incidentRows.length === 0 ? (
          <TabLoading label="Loading alerts..." />
        ) : relAlerts.length === 0 ? (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-6 text-center text-green-800 font-semibold flex items-center justify-center gap-2">
            <CheckCircle2 className="w-5 h-5" /> No alerts. All vital signs are within normal ranges.
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState message="No alerts match your filters." />
        ) : (
          <div className="space-y-3">
            {filtered.map((inc) => {
              const meta = SEV[inc.severity] ?? SEV.low;
              return (
                <div key={inc.id} className={`bg-white rounded-lg border border-gray-200 border-l-4 ${meta.border} p-4`}>
                  <div className="flex items-start gap-3">
                    <AlertTriangle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${meta.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <h4 className={`font-semibold ${inc.resolved ? "text-gray-500 line-through" : "text-gray-900"}`}>{inc.type}</h4>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${meta.badge}`}>{meta.label}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${inc.resolved ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{inc.resolved ? "Resolved" : "Open"}</span>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 mt-0.5">{inc.resident}{inc.room ? ` • Room ${inc.room}` : ""}</p>
                      {inc.description && <p className="text-sm text-gray-800 mt-2">{inc.description}</p>}
                      {inc.notes && <p className="text-sm text-gray-600 mt-2 p-2 bg-gray-50 rounded border-l-2 border-yellow-400">📝 {inc.notes}</p>}
                      <p className="text-xs text-gray-400 mt-2">{inc.timestamp ? new Date(String(inc.timestamp)).toLocaleString() : ""}{rel(inc.timestamp) ? ` • ${rel(inc.timestamp)}` : ""}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------ Messages
  if (tab === "messages") {
    const TYPE: Record<string, { label: string; badge: string }> = {
      GENERAL: { label: "General", badge: "bg-gray-100 text-gray-700" },
      NOTIFICATION: { label: "Notification", badge: "bg-blue-100 text-blue-700" },
      ALERT: { label: "Alert", badge: "bg-orange-100 text-orange-700" },
      URGENT: { label: "Urgent", badge: "bg-red-100 text-red-700" },
    };
    const typeMeta = (t: string) => TYPE[t] ?? TYPE.GENERAL;

    const msgs = messageRows.map((m: Record<string, unknown>, i: number) => {
      const sender = m.sender as { name?: string } | undefined;
      return {
        id: String(m.id ?? i),
        subject: String(m.subject ?? "") || humanize(String(m.messageType ?? "")) || "Message",
        content: String(m.content ?? ""),
        type: String(m.messageType ?? "GENERAL"),
        isRead: Boolean(m.isRead),
        from: sender?.name ?? "Care Team",
        ts: m.createdAt ? new Date(String(m.createdAt)).getTime() : 0,
        createdAt: m.createdAt ? new Date(String(m.createdAt)).toLocaleString() : "",
      };
    });

    const unread = msgs.filter((m) => !m.isRead).length;
    const urgent = msgs.filter((m) => (m.type === "URGENT" || m.type === "ALERT") && !m.isRead).length;
    const q = msgSearch.trim().toLowerCase();
    const filtered = msgs
      .filter((m) => (msgStatus === "unread" ? !m.isRead : true))
      .filter((m) => msgType === "all" || m.type === msgType)
      .filter((m) => !q || m.subject.toLowerCase().includes(q) || m.content.toLowerCase().includes(q) || m.from.toLowerCase().includes(q))
      .sort((a, b) => b.ts - a.ts);

    const rel = (ts: number) => {
      if (!ts || !nowTs) return "";
      const mn = Math.round((nowTs - ts) / 60000);
      return mn < 1 ? "just now" : mn < 60 ? `${mn}m ago` : mn < 1440 ? `${Math.round(mn / 60)}h ago` : `${Math.round(mn / 1440)}d ago`;
    };

    const markRead = async (id: string) => {
      try {
        await updateRecord("messages", id, { isRead: true, readAt: new Date().toISOString() });
        await refetchMessages();
      } catch (err) {
        Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not mark as read.", icon: "error" });
      }
    };

    const sendMessage = async () => {
      if (!composeForm.content.trim()) { Swal.fire({ title: "Message empty", text: "Write a message before sending.", icon: "warning" }); return; }
      setSendingMsg(true);
      try {
        await createRecord("messages", {
          subject: composeForm.subject.trim() || null,
          content: composeForm.content.trim(),
          messageType: composeForm.messageType,
          isRead: false,
        });
        await refetchMessages();
        setShowCompose(false);
        setComposeForm({ subject: "", content: "", messageType: "GENERAL" });
        Swal.fire({ title: "Message Sent", icon: "success", timer: 1400, showConfirmButton: false });
      } catch (err) {
        Swal.fire({ title: "Send Failed", text: err instanceof Error ? err.message : "Could not send message.", icon: "error" });
      } finally {
        setSendingMsg(false);
      }
    };

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-blue-500 flex-shrink-0" /> Messages
            </h1>
            <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
              <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
              Conversations with the care team
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void refetchMessages()} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium"><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={() => { setComposeForm({ subject: "", content: "", messageType: "GENERAL" }); setShowCompose(true); }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg hover:shadow-lg transition text-sm"><Plus className="w-4 h-4" /> New Message</button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <ReportStat label="Total" value={msgs.length} icon={MessageSquare} tone="gray" />
          <ReportStat label="Unread" value={unread} icon={Mail} tone={unread > 0 ? "blue" : "green"} />
          <ReportStat label="Urgent" value={urgent} icon={AlertTriangle} tone={urgent > 0 ? "red" : "green"} />
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white">
            {(["all", "unread"] as const).map((f) => (
              <button key={f} onClick={() => setMsgStatus(f)} className={`flex-1 px-4 py-2 text-sm font-medium capitalize transition ${msgStatus === f ? "bg-blue-500 text-white" : "text-gray-700 hover:bg-gray-50"}`}>{f}</button>
            ))}
          </div>
          <select value={msgType} onChange={(e) => setMsgType(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 outline-none">
            <option value="all">All Types</option>
            {Object.keys(TYPE).map((k) => <option key={k} value={k}>{TYPE[k].label}</option>)}
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
            <input type="text" placeholder="Search messages…" value={msgSearch} onChange={(e) => setMsgSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none" />
          </div>
        </div>

        {/* List */}
        {messageLoading && messageRows.length === 0 ? (
          <TabLoading label="Loading messages..." />
        ) : msgs.length === 0 ? (
          <EmptyState message="No messages yet. Start a conversation with the care team." />
        ) : filtered.length === 0 ? (
          <EmptyState message="No messages match your filters." />
        ) : (
          <div className="space-y-3">
            {filtered.map((m) => (
              <div key={m.id} className={`bg-white rounded-lg p-4 border ${m.isRead ? "border-gray-200" : "border-blue-300 bg-blue-50/40"}`}>
                <div className="flex items-start gap-3">
                  {!m.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <h4 className={`font-semibold ${m.isRead ? "text-gray-800" : "text-gray-900"}`}>{m.subject}</h4>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${typeMeta(m.type).badge}`}>{typeMeta(m.type).label}</span>
                        <span className="text-xs text-gray-400">{rel(m.ts)}</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">From {m.from}</p>
                    <p className="text-sm text-gray-700 mt-2">{m.content}</p>
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <span className="text-xs text-gray-400">{m.createdAt}</span>
                      {!m.isRead && (
                        <button onClick={() => void markRead(m.id)} className="flex items-center gap-1 px-2.5 py-1 text-blue-600 hover:bg-blue-50 rounded text-xs font-medium transition"><CheckCircle2 className="w-3.5 h-3.5" /> Mark read</button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Compose modal */}
        {showCompose && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
              <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white p-5 flex items-center justify-between">
                <h2 className="text-xl font-bold">Message Care Team</h2>
                <button onClick={() => setShowCompose(false)} className="p-2 hover:bg-white/10 rounded-lg transition"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <FormField label="Subject"><input type="text" value={composeForm.subject} onChange={(e) => setComposeForm((f) => ({ ...f, subject: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 outline-none" /></FormField>
                <FormField label="Priority"><select value={composeForm.messageType} onChange={(e) => setComposeForm((f) => ({ ...f, messageType: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 outline-none">{Object.keys(TYPE).map((k) => <option key={k} value={k}>{TYPE[k].label}</option>)}</select></FormField>
                <FormField label="Message *"><textarea value={composeForm.content} onChange={(e) => setComposeForm((f) => ({ ...f, content: e.target.value }))} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-400 outline-none resize-y" placeholder="Write your message to the care team…" /></FormField>
              </div>
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
                <button onClick={() => setShowCompose(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
                <button onClick={() => void sendMessage()} disabled={sendingMsg} className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-60"><Send className="w-4 h-4" /> {sendingMsg ? "Sending…" : "Send"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------- Appointments
  if (tab === "appointments") {
    const now = nowTs || 0;
    const AVATAR_COLORS = ["bg-blue-100 text-blue-700", "bg-purple-100 text-purple-700", "bg-green-100 text-green-700", "bg-rose-100 text-rose-700", "bg-amber-100 text-amber-700"];
    const enriched = visitRows.map((v: Record<string, unknown>, i: number) => {
      const inTs = v.checkInTime ? new Date(String(v.checkInTime)).getTime() : 0;
      const outTs = v.checkOutTime ? new Date(String(v.checkOutTime)).getTime() : 0;
      const upcoming = inTs > now;
      const name = String(v.visitorName ?? "Guest");
      return {
        id: String(v.id ?? i), name,
        relationship: String(v.relationship ?? ""),
        purpose: String(v.purpose ?? ""),
        phone: String(v.visitorPhone ?? ""),
        notes: String(v.notes ?? ""),
        inTs, outTs, upcoming,
        status: upcoming ? "Scheduled" : outTs ? "Completed" : "Visited",
        durationMin: outTs && inTs ? Math.round((outTs - inTs) / 60000) : 0,
        avatar: AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length],
      };
    });

    const q = visitSearch.trim().toLowerCase();
    const filtered = enriched
      .filter((v) => (visitFilter === "all" ? true : visitFilter === "upcoming" ? v.upcoming : !v.upcoming))
      .filter((v) => !q || v.name.toLowerCase().includes(q) || v.relationship.toLowerCase().includes(q) || v.purpose.toLowerCase().includes(q))
      .sort((a, b) => (a.upcoming && b.upcoming ? a.inTs - b.inTs : b.inTs - a.inTs));

    const monthCount = enriched.filter((v) => { if (!v.inTs || !now) return false; const d = new Date(v.inTs), n = new Date(now); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); }).length;
    const uniqueVisitors = new Set(enriched.map((v) => v.name)).size;
    const statusBadge = (s: string) => s === "Scheduled" ? "bg-blue-100 text-blue-700" : s === "Completed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700";

    const emptyForm = { visitorName: "", relationship: "", purpose: "", date: "", phone: "", notes: "" };
    const createVisit = async () => {
      if (!visitForm.visitorName.trim() || !visitForm.date) {
        Swal.fire({ title: "Missing info", text: "Visitor name and date/time are required.", icon: "warning" });
        return;
      }
      if (!relative) { Swal.fire({ title: "No relative linked", icon: "error" }); return; }
      setSavingVisit(true);
      try {
        await createRecord("visits", {
          residentId: relative.id,
          visitorName: visitForm.visitorName.trim(),
          relationship: visitForm.relationship.trim() || null,
          purpose: visitForm.purpose.trim() || null,
          visitorPhone: visitForm.phone.trim() || null,
          notes: visitForm.notes.trim() || null,
          checkInTime: new Date(visitForm.date).toISOString(),
        });
        await refetchVisits();
        setShowVisitForm(false);
        setVisitForm(emptyForm);
        Swal.fire({ title: "Visit Requested", icon: "success", timer: 1400, showConfirmButton: false });
      } catch (err) {
        Swal.fire({ title: "Request Failed", text: err instanceof Error ? err.message : "Could not save visit.", icon: "error" });
      } finally {
        setSavingVisit(false);
      }
    };

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Calendar className="w-6 h-6 text-purple-500 flex-shrink-0" /> Appointments &amp; Visits
            </h1>
            <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
              <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
              Visits with {relativeDisplayName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void refetchVisits()} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium"><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={() => { setVisitForm(emptyForm); setShowVisitForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white font-semibold rounded-lg hover:shadow-lg transition text-sm"><Plus className="w-4 h-4" /> Request Visit</button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <ReportStat label="Total Visits" value={enriched.length} icon={Calendar} tone="gray" />
          <ReportStat label="Upcoming" value={enriched.filter((v) => v.upcoming).length} icon={Clock} tone="blue" />
          <ReportStat label="This Month" value={monthCount} icon={CheckCircle2} tone="green" />
          <ReportStat label="Visitors" value={uniqueVisitors} icon={Activity} tone="rose" />
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white self-start">
            {(["all", "upcoming", "past"] as const).map((f) => (
              <button key={f} onClick={() => setVisitFilter(f)} className={`px-4 py-2 text-sm font-medium capitalize transition ${visitFilter === f ? "bg-purple-500 text-white" : "text-gray-700 hover:bg-gray-50"}`}>{f}</button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
            <input type="text" placeholder="Search visitor, relationship, purpose…" value={visitSearch} onChange={(e) => setVisitSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none" />
          </div>
        </div>

        {/* List */}
        {visitLoading && visitRows.length === 0 ? (
          <TabLoading label="Loading appointments..." />
        ) : filtered.length === 0 ? (
          <EmptyState message={visitRows.length === 0 ? "No visits recorded yet. Request the first one." : "No visits match your filters."} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((v) => (
              <div key={v.id} className={`bg-white rounded-lg border p-4 ${v.upcoming ? "border-purple-200" : "border-gray-200"}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold flex-shrink-0 ${v.avatar}`}>{v.name.charAt(0).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-gray-900 truncate">{v.name}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${statusBadge(v.status)}`}>{v.status}</span>
                    </div>
                    {v.relationship && <p className="text-xs text-gray-600">{v.relationship}</p>}
                  </div>
                </div>
                <div className="mt-3 space-y-1.5 text-sm">
                  <p className="flex items-center gap-2 text-gray-700"><Clock className="w-4 h-4 text-gray-400 flex-shrink-0" /> {v.inTs ? new Date(v.inTs).toLocaleString() : "—"}</p>
                  {v.purpose && <p className="flex items-center gap-2 text-gray-700"><Activity className="w-4 h-4 text-gray-400 flex-shrink-0" /> {v.purpose}</p>}
                  {v.durationMin > 0 && <p className="flex items-center gap-2 text-gray-500 text-xs"><CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" /> {v.durationMin >= 60 ? `${Math.floor(v.durationMin / 60)}h ${v.durationMin % 60}m` : `${v.durationMin}m`} visit</p>}
                  {v.phone && <p className="flex items-center gap-2 text-gray-500 text-xs"><Phone className="w-4 h-4 text-gray-400 flex-shrink-0" /> {v.phone}</p>}
                </div>
                {v.notes && <p className="mt-2 text-xs text-gray-600 p-2 bg-gray-50 rounded border-l-2 border-purple-300">📝 {v.notes}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Request Visit modal */}
        {showVisitForm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
              <div className="sticky top-0 bg-gradient-to-r from-purple-500 to-purple-600 text-white p-5 flex items-center justify-between">
                <h2 className="text-xl font-bold">Request a Visit</h2>
                <button onClick={() => setShowVisitForm(false)} className="p-2 hover:bg-white/10 rounded-lg transition"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Visitor Name *"><input type="text" value={visitForm.visitorName} onChange={(e) => setVisitForm((f) => ({ ...f, visitorName: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-400 outline-none" /></FormField>
                  <FormField label="Relationship"><input type="text" value={visitForm.relationship} onChange={(e) => setVisitForm((f) => ({ ...f, relationship: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-400 outline-none" /></FormField>
                </div>
                <FormField label="Date &amp; Time *"><input type="datetime-local" value={visitForm.date} onChange={(e) => setVisitForm((f) => ({ ...f, date: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-400 outline-none" /></FormField>
                <FormField label="Purpose"><input type="text" value={visitForm.purpose} onChange={(e) => setVisitForm((f) => ({ ...f, purpose: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-400 outline-none" /></FormField>
                <FormField label="Phone"><input type="text" value={visitForm.phone} onChange={(e) => setVisitForm((f) => ({ ...f, phone: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-400 outline-none" /></FormField>
                <FormField label="Notes"><textarea value={visitForm.notes} onChange={(e) => setVisitForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-400 outline-none resize-y" /></FormField>
              </div>
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
                <button onClick={() => setShowVisitForm(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
                <button onClick={() => void createVisit()} disabled={savingVisit} className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-60"><Plus className="w-4 h-4" /> {savingVisit ? "Saving…" : "Request Visit"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------- Billing
  if (tab === "expenses") {
    const STATUS: Record<string, { label: string; badge: string; bar: string }> = {
      DRAFT: { label: "Draft", badge: "bg-gray-100 text-gray-700 border-gray-200", bar: "bg-gray-400" },
      SENT: { label: "Sent", badge: "bg-blue-100 text-blue-700 border-blue-200", bar: "bg-blue-500" },
      PAID: { label: "Paid", badge: "bg-green-100 text-green-700 border-green-200", bar: "bg-green-500" },
      OVERDUE: { label: "Overdue", badge: "bg-red-100 text-red-700 border-red-200", bar: "bg-red-500" },
      CANCELLED: { label: "Cancelled", badge: "bg-gray-100 text-gray-500 border-gray-200", bar: "bg-gray-300" },
    };
    const statusMeta = (s: string) => STATUS[s] ?? STATUS.DRAFT;
    const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
    const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

    // Normalize
    const invoices = invoiceRows.map((inv: unknown) => adaptInvoice(inv));
    const serviceCharges = chargeRows.map((sc: unknown) => adaptServiceCharge(sc));
    const insuranceValidations = insuranceRows.map((iv: unknown) => adaptInsuranceValidation(iv));
    const payments = paymentRows.map((p: unknown) => adaptPayment(p));

    const activeInvoices = invoices.filter((v) => v.status !== "CANCELLED");
    const totalBilled = activeInvoices.reduce((s, v) => s + v.totalAmount, 0);
    const totalPaid = activeInvoices.reduce((s, v) => s + v.amountPaid, 0);
    const balanceDue = Math.max(0, totalBilled - totalPaid);

    // Overdue Calculations
    const overdueList = activeInvoices.filter((v) => {
      const dueTs = v.dueDate ? new Date(v.dueDate).getTime() : 0;
      return v.status === "OVERDUE" || (v.balance > 0 && dueTs > 0 && nowTs > 0 && dueTs < nowTs && v.status !== "PAID");
    });
    const overdueAmount = overdueList.reduce((s, v) => s + v.balance, 0);
    const paidPct = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0;

    // Filters & Sorting
    const q = invSearch.trim().toLowerCase();
    const filteredInvoices = invoices
      .filter((v) => invStatus === "all" || (invStatus === "overdue" ? overdueList.some(o => o.id === v.id) : v.status === invStatus))
      .filter((v) => !q || v.invoiceNumber.toLowerCase().includes(q) || v.description.toLowerCase().includes(q))
      .sort((a, b) => {
        const aTs = a.dueDate ? new Date(a.dueDate).getTime() : 0;
        const bTs = b.dueDate ? new Date(b.dueDate).getTime() : 0;
        return bTs - aTs;
      });

    // Mock Payment Gateway Action
    const handlePayNow = (inv: Invoice) => {
      setPayingInvoice(inv);
      setPayForm({ cardName: "", cardNumber: "", cardExpiry: "", cardCvv: "" });
    };

    const submitOnlinePayment = async () => {
      if (!payForm.cardName || !payForm.cardNumber || !payForm.cardExpiry || !payForm.cardCvv) {
        Swal.fire("Missing Fields", "Please populate card details.", "warning");
        return;
      }
      setProcessingPayment(true);
      
      // Simulate real-time stripe payment gateway latency
      setTimeout(async () => {
        try {
          const txnId = `TXN-ONL-${Date.now()}`;
          // 1. Record payment
          await createRecord("payments", {
            invoiceId: payingInvoice.id,
            amount: payingInvoice.balance,
            paymentMethod: "CARD",
            transactionId: txnId,
            notes: `Authorized via Online Sponsor Portal. Cardholder: ${payForm.cardName}`
          });

          // 2. Mark Invoice PAID
          await updateRecord("invoices", payingInvoice.id, {
            amountPaid: payingInvoice.totalAmount,
            status: "PAID",
            paidAt: new Date().toISOString()
          });

          await refetchInvoices();
          await refetchPayments();
          await refetchCharges();

          // Get the new payment object
          const newPaymentMock = {
            transactionId: txnId,
            invoiceNumber: payingInvoice.invoiceNumber,
            residentName: payingInvoice.residentName,
            amount: payingInvoice.balance,
            paymentDate: new Date(),
            paymentMethod: "CARD (ONLINE)"
          };

          setProcessingPayment(false);
          setPayingInvoice(null);
          Swal.fire({
            title: "Payment Authorized",
            text: `Transaction ${txnId} captured. Thank you for your payment.`,
            icon: "success"
          }).then(() => {
            // Automatically prompt receipt view
            setViewingReceipt(newPaymentMock);
          });
        } catch (err: unknown) {
          setProcessingPayment(false);
          const msg = err instanceof Error ? err.message : "Online authorization failed.";
          Swal.fire("Gateway Error", msg, "error");
        }
      }, 1800);
    };

    return (
      <div className="space-y-6 animate-fadeIn">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-2 tracking-tight">
              <Receipt className="w-6 h-6 text-yellow-500 flex-shrink-0" /> Billing &amp; Finance
            </h1>
            <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
              <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
              Real-time payment portal for {relativeDisplayName}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white shadow-sm">
              <button onClick={() => setBillView("list")} className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold transition ${billView === "list" ? "bg-yellow-400 text-black font-extrabold" : "text-gray-700 hover:bg-gray-50"}`}>
                <Receipt className="w-4 h-4" /> Billing Modules
              </button>
              <button onClick={() => setBillView("analytics")} className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold transition border-l border-gray-300 ${billView === "analytics" ? "bg-yellow-400 text-black font-extrabold" : "text-gray-700 hover:bg-gray-50"}`}>
                <Activity className="w-4 h-4" /> Financial Reports
              </button>
            </div>
            <button onClick={() => exportInvoicesCsv(invoices.map(i => ({
              id: i.id, number: i.invoiceNumber, description: i.description,
              total: i.totalAmount, paid: i.amountPaid, balance: i.balance, status: i.status,
              dueTs: i.dueDate ? new Date(i.dueDate).getTime() : 0, overdue: i.balance > 0,
              periodStart: i.billingPeriodStart ? new Date(i.billingPeriodStart) : null,
              periodEnd: i.billingPeriodEnd ? new Date(i.billingPeriodEnd) : null
            })))} disabled={invoices.length === 0} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-xs font-bold disabled:opacity-50">
              <FileText className="w-4 h-4" /> Export CSV
            </button>
            <button onClick={() => { void refetchInvoices(); void refetchPayments(); }} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-xs font-bold">
              <RefreshCw className="w-4 h-4" /> Sync Ledger
            </button>
          </div>
        </div>

        {/* Financial summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <MoneyStat label="Total Billed" value={fmt(totalBilled)} icon={FileText} tone="gray" />
          <MoneyStat label="Total Paid" value={fmt(totalPaid)} icon={CheckCircle2} tone="green" />
          <MoneyStat label="Balance Due" value={fmt(balanceDue)} icon={Wallet} tone={balanceDue > 0 ? "amber" : "green"} />
          <MoneyStat label="Overdue Balance" value={fmt(overdueAmount)} icon={AlertTriangle} tone={overdueAmount > 0 ? "red" : "green"} sub={overdueList.length ? `${overdueList.length} overdue` : undefined} />
        </div>

        {billView === "analytics" && <BillingAnalytics invoices={invoices.map(i => ({
          id: i.id, number: i.invoiceNumber, description: i.description,
          total: i.totalAmount, paid: i.amountPaid, balance: i.balance, status: i.status,
          dueTs: i.dueDate ? new Date(i.dueDate).getTime() : 0, overdue: i.balance > 0,
          periodStart: i.billingPeriodStart ? new Date(i.billingPeriodStart) : null,
          periodEnd: i.billingPeriodEnd ? new Date(i.billingPeriodEnd) : null
        }))} />}

        {billView === "list" && (
          <div className="space-y-6">
            {/* Sub Tabs: Invoices, Service Charges, Insurance */}
            <div className="flex border-b border-gray-200 gap-4 text-sm font-semibold">
              <button onClick={() => setBillSubTab("invoices")} className={`pb-2 border-b-2 transition ${billSubTab === "invoices" ? "border-yellow-500 text-yellow-600 font-bold" : "border-transparent text-gray-500 hover:text-gray-900"}`}>
                Invoices &amp; Receipts
              </button>
              <button onClick={() => setBillSubTab("charges")} className={`pb-2 border-b-2 transition ${billSubTab === "charges" ? "border-yellow-500 text-yellow-600 font-bold" : "border-transparent text-gray-500 hover:text-gray-900"}`}>
                Service Charge History
              </button>
              <button onClick={() => setBillSubTab("insurance")} className={`pb-2 border-b-2 transition ${billSubTab === "insurance" ? "border-yellow-500 text-yellow-600 font-bold" : "border-transparent text-gray-500 hover:text-gray-900"}`}>
                Insurance Policy
              </button>
            </div>

            {/* Sub Tab: Invoices */}
            {billSubTab === "invoices" && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <select value={invStatus} onChange={(e) => setInvStatus(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-yellow-400 outline-none text-sm font-semibold">
                    <option value="all">All Invoices</option>
                    <option value="overdue">Overdue</option>
                    {Object.keys(STATUS).map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}
                  </select>
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
                    <input type="text" placeholder="Search invoice number or description…" value={invSearch} onChange={(e) => setInvSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm" />
                  </div>
                </div>

                {invoiceLoading && invoiceRows.length === 0 ? (
                  <TabLoading label="Loading invoices..." />
                ) : invoices.length === 0 ? (
                  <EmptyState message="No invoices on file." />
                ) : filteredInvoices.length === 0 ? (
                  <EmptyState message="No invoices match your filters." />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredInvoices.map((v) => {
                      const pct = v.totalAmount > 0 ? Math.round((v.amountPaid / v.totalAmount) * 100) : 0;
                      const isOverdue = overdueList.some(o => o.id === v.id);
                      return (
                        <div key={v.id} className={`bg-white rounded-xl border p-5 shadow-sm transition hover:shadow flex flex-col justify-between ${isOverdue ? "border-red-200 bg-red-50/10" : "border-gray-200"}`}>
                          <div>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="min-w-0">
                                <h4 className="font-extrabold text-gray-900 text-lg leading-tight truncate">{v.invoiceNumber}</h4>
                                {v.description && <p className="text-xs text-gray-500 font-semibold mt-0.5 truncate">{v.description}</p>}
                              </div>
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${isOverdue ? "bg-red-100 text-red-700 border-red-200" : statusMeta(v.status).badge}`}>
                                {isOverdue ? "Overdue" : statusMeta(v.status).label}
                              </span>
                            </div>
                            {(v.billingPeriodStart && v.billingPeriodEnd) && (
                              <p className="text-xs text-gray-400 font-semibold mb-3">Period: {new Date(v.billingPeriodStart).toLocaleDateString()} – {new Date(v.billingPeriodEnd).toLocaleDateString()}</p>
                            )}

                            <div className="grid grid-cols-3 gap-2 text-center my-4 py-2 border-y border-dashed border-gray-100 bg-gray-50/40 rounded-lg">
                              <div><p className="text-[10px] uppercase font-bold text-gray-400">Total</p><p className="font-extrabold text-gray-900">{fmt(v.totalAmount)}</p></div>
                              <div><p className="text-[10px] uppercase font-bold text-gray-400">Paid</p><p className="font-extrabold text-green-600">{fmt(v.amountPaid)}</p></div>
                              <div><p className="text-[10px] uppercase font-bold text-gray-400">Balance</p><p className={`font-extrabold ${v.balance > 0 ? "text-amber-600" : "text-gray-400"}`}>{fmt(v.balance)}</p></div>
                            </div>
                            
                            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full ${pct === 100 ? "bg-green-500" : "bg-yellow-400"} transition-all`} style={{ width: `${pct}%` }} />
                            </div>
                            <p className={`text-xs mt-3 flex items-center gap-1.5 ${isOverdue ? "text-red-600 font-extrabold" : "text-gray-500 font-medium"}`}>
                              <Clock className="w-4 h-4" /> Due {v.dueDate ? new Date(v.dueDate).toLocaleDateString() : "—"}
                            </p>
                          </div>

                          <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                            {v.balance > 0 && v.status !== "DRAFT" && (
                              <button onClick={() => handlePayNow(v)} className="flex-1 py-2 bg-yellow-400 hover:bg-yellow-500 text-black font-extrabold rounded-lg text-xs transition shadow-sm active:scale-95 flex items-center justify-center gap-1.5">
                                <CreditCard className="w-3.5 h-3.5" /> Pay Balance Online
                              </button>
                            )}
                            {v.amountPaid > 0 && (
                              <button onClick={() => {
                                const relPayment = payments.find(p => p.invoiceId === v.id);
                                if (relPayment) {
                                  setViewingReceipt(relPayment);
                                } else {
                                  setViewingReceipt({
                                    transactionId: `TXN-GEN-${v.id.slice(-6)}`,
                                    invoiceNumber: v.invoiceNumber,
                                    residentName: v.residentName,
                                    amount: v.amountPaid,
                                    paymentDate: v.paidAt || new Date(),
                                    paymentMethod: "OFFLINE RECORD"
                                  });
                                }
                              }} className="flex-1 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold border border-gray-200 rounded-lg text-xs transition flex items-center justify-center gap-1.5">
                                <Printer className="w-3.5 h-3.5 text-gray-500" /> View Payment Receipt
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Sub Tab: Service Charges */}
            {billSubTab === "charges" && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                      <tr>
                        <th className="px-6 py-4">Service Date</th>
                        <th className="px-6 py-4">Category</th>
                        <th className="px-6 py-4">Description</th>
                        <th className="px-6 py-4">Amount</th>
                        <th className="px-6 py-4">Invoiced</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 text-gray-700">
                      {chargeLoading ? (
                        <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">Loading service charges...</td></tr>
                      ) : serviceCharges.length > 0 ? serviceCharges.map((sc) => (
                        <tr key={sc.id} className="hover:bg-gray-50/50">
                          <td className="px-6 py-4 text-xs font-semibold text-gray-500">{sc.serviceDate ? new Date(sc.serviceDate).toLocaleDateString() : ""}</td>
                          <td className="px-6 py-4"><span className="px-2.5 py-1 bg-purple-50 text-purple-700 border border-purple-100 rounded-lg text-xs font-bold">{sc.category}</span></td>
                          <td className="px-6 py-4 max-w-[200px] truncate">{sc.description}</td>
                          <td className="px-6 py-4 font-bold text-gray-900">${sc.amount.toLocaleString()}</td>
                          <td className="px-6 py-4">
                            {sc.invoiceId ? (
                              <span className="text-green-700 font-bold text-xs flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Billed ({sc.invoiceNumber})</span>
                            ) : (
                              <span className="text-amber-700 font-bold text-xs flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-amber-500" /> Pending</span>
                            )}
                          </td>
                        </tr>
                      )) : (
                        <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">No recorded service charges.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Sub Tab: Insurance */}
            {billSubTab === "insurance" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {insuranceLoading ? (
                  <div className="bg-white p-8 border rounded-xl text-center text-gray-500 col-span-full">Loading policies...</div>
                ) : insuranceValidations.length > 0 ? insuranceValidations.map((iv) => (
                  <div key={iv.id} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
                    <div className="flex justify-between items-start border-b border-gray-100 pb-3">
                      <div>
                        <h4 className="font-extrabold text-gray-900 text-lg leading-tight">{iv.provider}</h4>
                        <p className="text-xs text-gray-400 font-bold mt-1">Policy: {iv.policyNumber}</p>
                      </div>
                      <span className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${
                        iv.status === "VALIDATED" ? "bg-green-50 text-green-700 border-green-200" :
                        iv.status === "FAILED" ? "bg-red-50 text-red-700 border-red-200" :
                        "bg-yellow-50 text-yellow-700 border-yellow-200"
                      }`}>
                        {iv.status}
                      </span>
                    </div>
                    <div className="text-xs space-y-2 text-gray-700">
                      {iv.groupNumber && <p><span className="font-semibold text-gray-500">Group Number:</span> {iv.groupNumber}</p>}
                      <p><span className="font-semibold text-gray-500">Coverage Terms:</span> {iv.coverageDetails}</p>
                      {iv.verifiedAt && <p className="text-gray-400 italic pt-2 border-t border-gray-100">Gateway verification checked on {new Date(iv.verifiedAt).toLocaleDateString()}.</p>}
                    </div>
                  </div>
                )) : (
                  <div className="bg-white p-8 border rounded-xl text-center text-gray-500 col-span-full">No active insurance verification policy files found.</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── ONLINE CHECKOUT GATEWAY MODAL ── */}
        {payingInvoice && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
              <div className="sticky top-0 bg-gray-900 text-white p-5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-yellow-400" />
                  <span className="font-bold">Secure Card Checkout</span>
                </div>
                <button onClick={() => setPayingInvoice(null)} disabled={processingPayment} className="p-2 hover:bg-white/10 rounded-lg transition"><X className="w-5 h-5" /></button>
              </div>

              <div className="p-6 space-y-5">
                <div className="bg-gray-50 rounded-lg p-4 text-xs space-y-2 border border-gray-100">
                  <div className="flex justify-between"><span>Billing Invoice:</span><span className="font-bold text-gray-800">{payingInvoice.invoiceNumber}</span></div>
                  <div className="flex justify-between"><span>Resident:</span><span className="font-bold text-gray-800">{payingInvoice.residentName}</span></div>
                  <div className="flex justify-between text-sm border-t border-dashed border-gray-200 pt-2"><span className="font-bold text-gray-700">Amount Due:</span><span className="font-extrabold text-yellow-600">${payingInvoice.balance.toLocaleString()}</span></div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cardholder Name *</label>
                    <input type="text" placeholder="John Sponsor" value={payForm.cardName} onChange={(e) => setPayForm({ ...payForm, cardName: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Credit Card Number *</label>
                    <input type="text" placeholder="4111 2222 3333 4444" value={payForm.cardNumber} onChange={(e) => setPayForm({ ...payForm, cardNumber: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Expiry Date *</label>
                      <input type="text" placeholder="MM/YY" value={payForm.cardExpiry} onChange={(e) => setPayForm({ ...payForm, cardExpiry: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CVV/CVC *</label>
                      <input type="password" placeholder="***" maxLength={4} value={payForm.cardCvv} onChange={(e) => setPayForm({ ...payForm, cardCvv: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-400 bg-white" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-between items-center">
                <button onClick={() => setPayingInvoice(null)} disabled={processingPayment} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm font-semibold transition">
                  Cancel
                </button>
                <button onClick={submitOnlinePayment} disabled={processingPayment} className="px-6 py-2 bg-yellow-400 hover:bg-yellow-500 text-black font-extrabold rounded-lg text-sm transition disabled:opacity-60 shadow flex items-center gap-1.5">
                  {processingPayment ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Authorizing Gateway...
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4" />
                      Authorize Payment
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── PRINTABLE RECEIPTS MODAL ── */}
        {viewingReceipt && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
              <div className="p-8 space-y-6 relative overflow-hidden" id="printable-receipt">
                <div className="absolute top-20 left-1/2 -translate-x-1/2 rotate-12 border-4 border-green-500/20 text-green-500/20 font-extrabold text-5xl px-6 py-2 tracking-widest pointer-events-none select-none rounded-xl">
                  PAID
                </div>
                <div className="text-center space-y-1">
                  <h2 className="text-2xl font-extrabold text-green-600 tracking-tight uppercase">Receipt of Payment</h2>
                  <p className="text-xs text-gray-500 font-semibold">Golden Hearth Assisted Living Facility</p>
                  <p className="text-[10px] text-gray-400 font-mono mt-1">TXN ID: {viewingReceipt.transactionId}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 space-y-4 text-xs mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div><span className="text-gray-500 block">Resident Name</span><strong className="text-gray-800 text-sm">{viewingReceipt.residentName}</strong></div>
                    <div><span className="text-gray-500 block">Invoice Reference</span><strong className="text-gray-800 text-sm">{viewingReceipt.invoiceNumber}</strong></div>
                    <div><span className="text-gray-500 block">Payment Date</span><strong className="text-gray-800 text-sm">{viewingReceipt.paymentDate ? new Date(viewingReceipt.paymentDate).toLocaleDateString() : ""}</strong></div>
                    <div><span className="text-gray-500 block">Method Used</span><strong className="text-gray-800 text-sm">{viewingReceipt.paymentMethod}</strong></div>
                  </div>
                  <div className="border-t border-dashed border-gray-200 pt-4 flex justify-between items-center text-sm">
                    <span className="font-extrabold text-gray-700">Total Captured</span>
                    <span className="font-black text-green-600 text-xl">${viewingReceipt.amount.toLocaleString()}</span>
                  </div>
                </div>
                <p className="text-center text-[9px] text-gray-400 mt-6 leading-relaxed">
                  Thank you for your payment. This receipt confirms that the funds have been successfully validated and processed.
                </p>
              </div>
              <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-between">
                <button onClick={() => setViewingReceipt(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 border border-gray-300 rounded-lg text-xs font-bold transition">Close</button>
                <button onClick={() => window.print()} className="flex items-center gap-2 px-5 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-xs transition"><Printer className="w-3.5 h-3.5" /> Print Receipt</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------ Photos
  // No clean DB mapping — kept static per spec.
  if (tab === "photos") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Photos</h2>
        <div className="bg-white rounded-lg p-6 border border-gray-200 text-gray-600 text-sm">
          Shared photos from care staff will appear here.
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------- Care Goals
  // No clean DB mapping — kept static per spec.
  if (tab === "goals") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Care Goals</h2>
        <div className="bg-white rounded-lg p-6 border border-gray-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-700">Maintain healthy blood pressure</span>
            <span className="text-green-600 font-semibold text-sm">On track</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-700">Daily physical activity</span>
            <span className="text-green-600 font-semibold text-sm">On track</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-700">Social engagement</span>
            <span className="text-blue-600 font-semibold text-sm">In progress</span>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------ Default: Dashboard
  const unreadMessages = messageRows.filter(
    (m: Record<string, unknown>) => !m.isRead
  ).length;

  const balanceDue = invoiceRows.reduce((sum: number, inv: Record<string, unknown>) => {
    if (String(inv.status ?? "") === "PAID") return sum;
    const total = parseFloat(String(inv.totalAmount ?? 0)) || 0;
    const paid = parseFloat(String(inv.amountPaid ?? 0)) || 0;
    return sum + Math.max(0, total - paid);
  }, 0);

  const recentMessages = messageRows.slice(0, 3);
  const upcomingVisits = visitRows.slice(0, 3);
  const topAlerts = incidents.slice(0, 4);
  const latestHR = liveVitals.find((v) => v.type === "HEART_RATE");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Heart className="w-6 h-6 text-red-500 flex-shrink-0" /> Welcome — {relativeDisplayName}
        </h1>
        <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
          <span className="inline-flex items-center gap-1 text-green-600">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
          </span>
          {relative ? `Room ${relative.room} • ${humanize(relative.careLevel)} Care${relative.age != null ? ` • Age ${relative.age}` : ""}` : "Your family member's care overview"}
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <StatCard
          title="Care Status"
          value={relative && relative.alertsCount > 0 ? `${relative.alertsCount} alert${relative.alertsCount === 1 ? "" : "s"}` : "Stable"}
          icon={Activity}
          backgroundColor={relative && relative.alertsCount > 0 ? "bg-red-50" : "bg-green-50"}
          textColor={relative && relative.alertsCount > 0 ? "text-red-900" : "text-green-900"}
          iconColor={relative && relative.alertsCount > 0 ? "text-red-500" : "text-green-500"}
        />
        <StatCard
          title="Heart Rate"
          value={latestHR ? String(latestHR.value) : "—"}
          unit={latestHR ? "bpm" : ""}
          icon={HeartPulse}
          backgroundColor="bg-rose-50"
          textColor="text-rose-900"
          iconColor="text-rose-500"
        />
        <StatCard
          title="Unread Messages"
          value={String(unreadMessages)}
          icon={MessageSquare}
          backgroundColor="bg-blue-50"
          textColor="text-blue-900"
          iconColor="text-blue-500"
        />
        <StatCard
          title="Appointments"
          value={String(visitRows.length)}
          icon={Calendar}
          backgroundColor="bg-purple-50"
          textColor="text-purple-900"
          iconColor="text-purple-500"
        />
        <StatCard
          title="Balance Due"
          value={`$${balanceDue.toFixed(0)}`}
          icon={DollarSign}
          backgroundColor="bg-yellow-50"
          textColor="text-yellow-900"
          iconColor="text-yellow-500"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left column: relative + vitals + trend */}
        <div className="xl:col-span-2 space-y-6">
          {relative && (
            <div className="bg-white rounded-lg p-6 border border-gray-200">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{relative.name}</h3>
                  <p className="text-gray-600 text-sm mt-1">Room {relative.room} • {humanize(relative.careLevel)} Care{relative.age != null ? ` • Age ${relative.age}` : ""}</p>
                </div>
                {relative.alertsCount > 0 && (
                  <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-semibold flex-shrink-0">
                    {relative.alertsCount} active alert{relative.alertsCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {(relative.allergies || relative.medicalHistory) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs font-semibold text-gray-600 mb-1">Allergies</p>
                    <p className="text-sm text-gray-900">{relative.allergies || "None recorded"}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs font-semibold text-gray-600 mb-1">Medical History</p>
                    <p className="text-sm text-gray-900">{relative.medicalHistory || "None recorded"}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {vitalsLoading && vitalsRows.length === 0 ? (
            <VitalsPanel vitals={[]} resident={relativeDisplayName} isLoading />
          ) : (
            <VitalsPanel vitals={liveVitals} resident={relativeDisplayName} />
          )}

          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <ChartContainer
              title="Heart Rate Trend"
              type="area"
              data={heartRateTrend.length ? heartRateTrend : mockVitalsData}
              dataKey="value"
              xAxisKey="name"
              colors={["#ef4444"]}
              height={220}
            />
          </div>
        </div>

        {/* Right column: alerts, messages, appointments */}
        <div className="space-y-6">
          <Panel title="Recent Alerts" icon={AlertTriangle} count={incidents.length}>
            {topAlerts.length > 0 ? (
              <div className="space-y-2">
                {topAlerts.map((inc) => (
                  <div key={inc.id} className={`p-2.5 rounded-lg border ${inc.severity === "critical" || inc.severity === "high" ? "bg-red-50 border-red-100" : "bg-gray-50 border-gray-200"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-900 text-sm truncate">{inc.type}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${
                        inc.severity === "critical" ? "bg-red-100 text-red-700" : inc.severity === "high" ? "bg-orange-100 text-orange-700" : inc.severity === "medium" ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700"
                      }`}>{inc.severity.toUpperCase()}</span>
                    </div>
                    <p className="text-xs text-gray-600 truncate">{inc.description || "Incident recorded"}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg p-3">✔ All vitals stable — no active alerts.</p>
            )}
          </Panel>

          <Panel title="Recent Messages" icon={MessageSquare} count={unreadMessages}>
            {recentMessages.length > 0 ? (
              <div className="space-y-2">
                {recentMessages.map((m: Record<string, unknown>, i: number) => (
                  <div key={(m.id as string) ?? i} className={`p-2.5 rounded-lg border ${m.isRead ? "border-gray-200" : "border-blue-200 bg-blue-50/50"}`}>
                    <p className="font-medium text-gray-900 text-sm truncate">{(m.subject as string) || humanize(m.messageType as string) || "Message"}</p>
                    <p className="text-xs text-gray-600 truncate">{(m.content as string) ?? ""}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-4 text-center">No messages yet.</p>
            )}
          </Panel>

          <Panel title="Upcoming Appointments" icon={Calendar} count={visitRows.length}>
            {upcomingVisits.length > 0 ? (
              <div className="space-y-2">
                {upcomingVisits.map((v: Record<string, unknown>, i: number) => (
                  <div key={(v.id as string) ?? i} className="p-2.5 rounded-lg bg-purple-50 border border-purple-100">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-900 text-sm truncate">{(v.visitorName as string) ?? "Visit"}</span>
                      <span className="text-xs text-gray-600 flex-shrink-0">{v.checkInTime ? new Date(v.checkInTime as string).toLocaleDateString() : "—"}</span>
                    </div>
                    <p className="text-xs text-gray-600 truncate">{(v.relationship as string) ?? ""}{v.purpose ? ` • ${String(v.purpose)}` : ""}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-4 text-center">No appointments scheduled.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ── Form field wrapper ──────────────────────────────────────────────── */
function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

/* ── Billing analytics ───────────────────────────────────────────────── */
interface InvoiceVM {
  id: string; number: string; description: string;
  total: number; paid: number; balance: number; status: string;
  dueTs: number; overdue: boolean;
  periodStart: Date | null; periodEnd: Date | null;
}
const STATUS_PIE_COLOR: Record<string, string> = {
  DRAFT: "#9ca3af", SENT: "#3b82f6", PAID: "#22c55e", OVERDUE: "#ef4444", CANCELLED: "#d1d5db",
};

function exportInvoicesCsv(rows: InvoiceVM[]): void {
  const headers = ["Invoice", "Description", "Total", "Paid", "Balance", "Status", "Due"];
  const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  rows.forEach((v) => lines.push([v.number, v.description, v.total, v.paid, v.balance, v.status, v.dueTs ? new Date(v.dueTs).toLocaleDateString() : ""].map(esc).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "invoices.csv"; a.click();
  URL.revokeObjectURL(url);
}

function BillingAnalytics({ invoices }: { invoices: InvoiceVM[] }) {
  const a = useMemo(() => {
    const map = new Map<string, { label: string; Billed: number; Paid: number; sort: number }>();
    invoices.forEach((v) => {
      const d = v.periodEnd ?? (v.dueTs ? new Date(v.dueTs) : null);
      if (!d) return;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const cur = map.get(key) ?? { label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }), Billed: 0, Paid: 0, sort: d.getFullYear() * 12 + d.getMonth() };
      cur.Billed += v.total; cur.Paid += v.paid;
      map.set(key, cur);
    });
    const byMonth = Array.from(map.values()).sort((x, y) => x.sort - y.sort);
    const statusPie = Object.keys(STATUS_PIE_COLOR)
      .map((k) => ({ name: k.charAt(0) + k.slice(1).toLowerCase(), key: k, value: invoices.filter((v) => v.status === k).length }))
      .filter((s) => s.value > 0);
    const topBalances = [...invoices].filter((v) => v.balance > 0).sort((x, y) => y.balance - x.balance).slice(0, 5);
    return { byMonth, statusPie, topBalances };
  }, [invoices]);

  if (invoices.length === 0) return <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No billing data to analyze.</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Billed vs Paid by Month</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={a.byMonth} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis fontSize={12} tickLine={false} axisLine={false} width={48} tickFormatter={(n) => `$${Math.round(Number(n) / 1000)}k`} />
            <Tooltip formatter={(n) => `$${Math.round(Number(n)).toLocaleString()}`} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Legend />
            <Bar dataKey="Billed" fill="#eab308" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Paid" fill="#22c55e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Invoices by Status</h3>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={a.statusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
              {a.statusPie.map((s, i) => <Cell key={i} fill={STATUS_PIE_COLOR[s.key]} />)}
            </Pie>
            <Tooltip /><Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Largest Outstanding Balances</h3>
        {a.topBalances.length > 0 ? (
          <div className="space-y-2">
            {a.topBalances.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-100">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">{v.number}</p>
                  <p className="text-xs text-gray-600 truncate">{v.description || "—"}</p>
                </div>
                <span className="font-bold text-amber-700 flex-shrink-0">${Math.round(v.balance).toLocaleString()}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-green-700 py-6 text-center">All invoices are fully paid. 🎉</p>}
      </div>
    </div>
  );
}

/* ── Money stat card ─────────────────────────────────────────────────── */
function MoneyStat({ label, value, icon: Icon, tone, sub }: { label: string; value: string; icon: typeof ChevronRight; tone: "gray" | "green" | "amber" | "red"; sub?: string }) {
  const T = {
    gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
    green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
    amber: { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-500", value: "text-amber-600" },
    red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  }[tone];
  return (
    <div className={`p-4 rounded-lg border ${T.wrap}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs sm:text-sm text-gray-600 font-semibold">{label}</p>
        <Icon className={`w-4 h-4 ${T.icon}`} />
      </div>
      <p className={`text-xl sm:text-2xl font-bold mt-1 ${T.value}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ── Report stat card ────────────────────────────────────────────────── */
const REPORT_TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
  rose: { wrap: "bg-rose-50 border-rose-200", icon: "text-rose-500", value: "text-rose-600" },
};
function ReportStat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof ChevronRight; tone: keyof typeof REPORT_TONES }) {
  const t = REPORT_TONES[tone];
  return (
    <div className={`p-4 rounded-lg border ${t.wrap}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs sm:text-sm text-gray-600 font-semibold">{label}</p>
        <Icon className={`w-4 h-4 ${t.icon}`} />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 ${t.value}`}>{value}</p>
    </div>
  );
}

/* ── Dashboard panel wrapper ─────────────────────────────────────────── */
function Panel({ title, icon: Icon, count, children }: { title: string; icon: typeof ChevronRight; count?: number; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Icon className="w-4 h-4 text-blue-500" /> {title}</h3>
        {typeof count === "number" && count > 0 && <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs font-bold">{count}</span>}
      </div>
      {children}
    </div>
  );
}
